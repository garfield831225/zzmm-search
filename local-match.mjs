// 本地直接跑 TMDB 匹配, 绕过 Vercel 函数 + read replica
// 复制 match-task 路由的核心逻辑
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

const TMDB_KEY = process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BATCH_PER_RUN = 100;  // 本地调快一点

const TMDB_LANG = 'zh-CN';

function isEnglishName(name) {
  return /^[a-zA-Z\s\d.'-]+$/.test(name.trim());
}

function isGarbled(name) {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i);
    if (cp === 0xfffd || cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = [0x2e, 0x3001, 0x3002, 0x2018, 0x2019, 0xff08, 0xff09, 0x300a, 0x300b, 0x5b, 0x5d, 0x28, 0x29, 0x2d].includes(cp);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}

function cleanTitle(name) {
  // 提取 [..] / (..) / 第N季 / 数字 等做搜索关键字
  return name
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/【[^】]+】/g, ' ')
    .replace(/\([^\)]+\)/g, ' ')
    .replace(/（[^）]+）/g, ' ')
    .replace(/第[一二三四五六七八九十0-9]+季?/g, ' ')
    .replace(/Season\s*\d+/gi, ' ')
    .replace(/S\d+/g, ' ')
    .replace(/E\d+/g, ' ')
    .replace(/\d{3,4}p/gi, ' ')
    .replace(/\d+(\.\d+)?\s*(GB|MB|KB|TB)/gi, ' ')
    .replace(/1080p|720p|2160p|4K|HDR|BluRay|WEB-?DL|BDRip|DVDRip|HDTV|x264|x265|HEVC|AVC|10bit|8bit|AAC|DDP|MA5\.1|DTS-HD|Atmos|TrueHD|FLAC|MP3|M4A|H\.264|H\.265/gi, ' ')
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function tmdbSearch(query, type) {
  try {
    const url = `${TMDB_BASE}/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(query)}&language=${TMDB_LANG}&page=1`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = await r.json();
    return d.results?.[0] || null;
  } catch { return null; }
}

async function matchOne(row) {
  let name = row.name;
  if (!name) return { status: 'GARBLED', tmdbId: null };
  if (isGarbled(name)) return { status: 'GARBLED', tmdbId: null };

  // clean title
  const cleaned = cleanTitle(name);
  if (!cleaned || cleaned.length < 2) return { status: 'NOMATCH', tmdbId: null };

  // decide type
  let type = 'multi';
  if (row.category === '电影' || row.sub_type === 'movie') type = 'movie';
  else if (row.category === '剧集' || row.category === '动漫' || row.category === '综艺' || row.category === '纪录片' || row.category === '演唱会' || row.category === '连载' || row.sub_type === 'tv') type = 'tv';

  // try by exact title
  for (const t of (type === 'multi' ? ['multi', 'tv', 'movie'] : [type])) {
    let r;
    if (t === 'multi') {
      r = await tmdbSearch(cleaned, 'multi') || await tmdbSearch(cleaned, 'tv') || await tmdbSearch(cleaned, 'movie');
    } else {
      r = await tmdbSearch(cleaned, t);
    }
    if (r && r.id) {
      return { status: 'OK', tmdbId: String(r.id) };
    }
  }
  return { status: 'NOMATCH', tmdbId: null };
}

let totalProcessed = 0;
let totalMatched = 0;
let totalNoMatch = 0;
let totalGarbled = 0;
let lastReport = Date.now();
const startTime = Date.now();

console.log('=== 本地 TMDB 匹配 worker ===');
console.log('TMDB_KEY:', TMDB_KEY.slice(0, 8) + '...');
console.log('batch:', BATCH_PER_RUN);

while (true) {
  const rows = await sql`
    SELECT id, name, category, sub_type FROM xx_resources
    WHERE tmdb_id IS NULL AND (matched_tmdb_at IS NULL OR matched_tmdb_at < NOW() - INTERVAL '5 minutes')
    ORDER BY id ASC LIMIT ${BATCH_PER_RUN}
  `;
  if (rows.length === 0) {
    console.log('--- 全部跑完, 退出 ---');
    break;
  }

  // 50 并发匹配
  const promises = rows.map(async row => {
    const r = await matchOne(row);
    if (r.status === 'OK') {
      try {
        await sql`UPDATE xx_resources SET tmdb_id = ${r.tmdbId}, matched_tmdb_at = NOW() WHERE id = ${row.id}`;
      } catch {}
    } else {
      try {
        await sql`UPDATE xx_resources SET tmdb_id = ${r.status}, matched_tmdb_at = NOW() WHERE id = ${row.id}`;
      } catch {}
    }
    return r;
  });
  const results = await Promise.all(promises);

  for (const r of results) {
    if (r.status === 'OK') totalMatched++;
    else if (r.status === 'NOMATCH') totalNoMatch++;
    else totalGarbled++;
  }
  totalProcessed += rows.length;

  // 每 30s 报告
  if (Date.now() - lastReport > 30000) {
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = totalProcessed / elapsed;
    console.log(`[${Math.round(elapsed)}s] processed=${totalProcessed}, matched=${totalMatched}, nomatch=${totalNoMatch}, garbled=${totalGarbled}, rate=${rate.toFixed(1)}/s`);
    lastReport = Date.now();
  }
}

const totalTime = (Date.now() - startTime) / 1000;
console.log(`\n=== 完成 ===`);
console.log(`total time: ${totalTime.toFixed(0)}s`);
console.log(`processed: ${totalProcessed}`);
console.log(`matched: ${totalMatched} (${(totalMatched/Math.max(totalProcessed,1)*100).toFixed(1)}%)`);
console.log(`no match: ${totalNoMatch}`);
console.log(`garbled: ${totalGarbled}`);
process.exit(0);
