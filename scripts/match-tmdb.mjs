/**
 * TMDB 批量匹配脚本 - GitHub Actions 版本
 * 用法: node scripts/match-tmdb.mjs
 * 环境变量:
 *   DATABASE_URL      - Neon 连接串
 *   TMDB_API_KEY_1    - TMDB API Key 1
 *   TMDB_API_KEY_2    - TMDB API Key 2
 *   BATCH_SIZE        - 每批处理数量 (默认500)
 *   DRY_RUN           - true=只测试不写入 (默认false)
 */

import { neon } from '@neondatabase/serverless';

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '3000');
const DRY_RUN = process.env.DRY_RUN === 'true';

console.log(`[match] Starting batch=${BATCH_SIZE} dry_run=${DRY_RUN}`);

// ─── 速率限制器 ──────────────────────────────────────────────────────────────
class RateLimiter {
  constructor() {
    this.lastCalls = TMDB_KEYS.map(() => 0);
    this.minInterval = 50; // 20 calls/sec per key
  }
  async wait(keyIndex) {
    const now = Date.now();
    const waitTime = Math.max(0, this.lastCalls[keyIndex] + this.minInterval - now);
    if (waitTime > 0) await sleep(waitTime);
    this.lastCalls[keyIndex] = Date.now();
  }
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function chineseToNumber(str) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}

function isEnglishName(name) {
  return /^[a-zA-Z\s\d.'-]+$/.test(name.trim());
}

function isGarbled(name) {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i);
    if (cp === 0xfffd) { garbageLen++; continue; }
    if (cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = [0x2e, 0x3001, 0x3002, 0x2018, 0x2019, 0xff08, 0xff09, 0x300a, 0x300b, 0x5b, 0x5d, 0x28, 0x29, 0x2d].includes(cp);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}

function cleanFolderName(folderName) {
  const yearMatch = folderName.match(/[.\s](20\d{2})[.\s]/);
  const extractedYear = yearMatch ? yearMatch[1] : '';

  let season = null;
  const seasonPatterns = [/第([一二三四五六七八九十\d]+)季/i, /Season\s*(\d+)/i, /S(\d{1,2})E\d+/i];
  for (const pat of seasonPatterns) {
    const m = folderName.match(pat);
    if (m) { season = chineseToNumber(m[1]); break; }
  }

  let cleanName = folderName
    .replace(/第[一二三四五六七八九十\d]+季/gi, '')
    .replace(/Season\s*\d+/gi, '')
    .replace(/S\d{1,2}E\d+/gi, '')
    .replace(/【([^】]+)】/g, '')
    .replace(/《([^》]+)》/g, '')
    .replace(/（([^）]+)）/g, '')
    .replace(/\(([^)]+)\)/g, '')
    .replace(/\[([^\]]+)\]/g, '');

  const noisePatterns = [
    /2160p|1080p|720p|480p/gi, /WEB-DL|BluRay|BDRip|HDTV|WEBRip|REMUX|Blu-ray|BDMV/gi,
    /H265|H264|HEVC|AVC|x264|x265/gi,
    /杜比视界|杜比全景声|DV|HDR10\+|HDR10|HDR|ATMOS|DDP5\.1|DDP|DTS-HD|DTS|AAC5\.1|AAC|TrueHD|EAC3/gi,
    /国语中字|中英双字|中英字幕|双语字幕|外挂字幕|国语配音|中文字幕|中字|字幕|粤语|台配|配音/gi,
    /导演剪辑版|导演剪辑|加长版|完整版|未删减版|剧场版|REMUX/gi,
    /IMAX|SDR|AC3/gi, /蓝光原盘|蓝光|蓝光remux|HD|内嵌|封包|封装/gi,
    /DIY|次时代|官译|特效字幕|双语|简繁|繁简/gi,
    /CEE|美版|日版|港版|韩版|欧版|台版/gi,
    /Athena@|CHDBits@|HDSky@|HDHome@|ltzww@/gi,
  ];
  for (const pat of noisePatterns) cleanName = cleanName.replace(pat, ' ');

  cleanName = cleanName.replace(/[.\s]?\d{4}.*$/g, '');
  cleanName = cleanName.replace(/\.(mkv|mp4|avi|ts|m2ts|wmv|flv)$/gi, '');
  cleanName = cleanName.replace(/\./g, ' ').replace(/\?/g, '').replace(/\s+/g, ' ').trim();

  return { cleanName, year: extractedYear, season };
}

// ─── 置信度评分 ────────────────────────────────────────────────────────────────
/**
 * 计算片名相似度（Jaccard on normalized character bigrams）
 * 适合中英文混合场景
 */
function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').trim();
  const a0 = norm(a), b0 = norm(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;

  // Bigram Jaccard
  const bigrams = (s) => {
    const cs = [...s];
    const bg = new Set();
    for (let i = 0; i < cs.length - 1; i++) bg.add(cs[i] + cs[i + 1]);
    if (cs.length === 1) bg.add(cs[0]); // 单字也加进去
    return bg;
  };
  const setA = bigrams(a0), setB = bigrams(b0);
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * 综合置信度评分
 * 检查：片名相似度 + 语言一致性 + 年份一致性（可选）
 */
function confidenceScore(cleanName, tmdbResult, searchLang, searchYear) {
  const zhNames = [tmdbResult.title, tmdbResult.original_title, tmdbResult.name].filter(Boolean);
  const enName = tmdbResult.title?.match(/[a-zA-Z]/) ? tmdbResult.title : '';

  // 检查各种片名组合的 substring 命中（翻译片名跨语言匹配）
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const cleanNorm = norm(cleanName);
  const allTitles = [...zhNames, enName].map(norm);
  let substringHit = false;
  for (const t of allTitles) {
    if (t.length >= 2 && (t.includes(cleanNorm) || cleanNorm.includes(t))) {
      substringHit = true;
      break;
    }
  }

  // 最高相似度
  const zhScore = Math.max(...zhNames.map(zn => titleSimilarity(cleanName, zn)));
  const enScore = enName ? titleSimilarity(cleanName, enName) : 0;
  const bestScore = Math.max(zhScore, enScore);

  // 直接 substring 命中 = 满分
  if (substringHit) return 1.0;

  // 语言一致性奖励：中文片名搜中文结果，英文搜英文
  let langBonus = 0;
  if (searchLang === 'zh-CN' && zhScore > enScore) langBonus = 0.1;
  if (searchLang === 'en-US' && enScore > zhScore) langBonus = 0.1;

  // 年份一致性奖励（误差 ±2 年）
  let yearBonus = 0;
  const resultYear = (tmdbResult.release_date || tmdbResult.first_air_date || '').slice(0, 4);
  if (searchYear && resultYear && Math.abs(parseInt(resultYear) - parseInt(searchYear)) <= 2) {
    yearBonus = 0.15;
  }

  return bestScore + langBonus + yearBonus;
}

// 最低接受阈值（片名相似度 + 加分项综合）
const MIN_CONFIDENCE = 0.32;

async function searchTmdb(name, type, year, lang, keyIndex) {
  await tmdbLimiter.wait(keyIndex);
  const endpoint = type === 'tv' ? '/search/tv' : '/search/movie';
  const yearParam = type === 'tv' ? 'first_air_date_year' : 'year';
  let url = `${TMDB_BASE}${endpoint}?query=${encodeURIComponent(name)}&api_key=${TMDB_KEYS[keyIndex]}&language=${lang}&page=1&include_adult=false`;
  if (year) url += `&${yearParam}=${year}`;

  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.results?.length) return null;
    return data.results.slice(0, 5); // 返回 top5 用于置信度筛选
  } catch { return null; }
}

async function matchOne(rawName) {
  if (isGarbled(rawName)) return 'GARBLED';

  const { cleanName, year, season } = cleanFolderName(rawName);
  if (cleanName.length < 2) return 'NOMATCH';

  const isEng = isEnglishName(cleanName);
  const strategies = isEng
    ? [{ lang: 'en-US', useYear: true }, { lang: 'en-US', useYear: false }, { lang: 'zh-CN', useYear: true }]
    : [{ lang: 'zh-CN', useYear: true }, { lang: 'zh-CN', useYear: false }, { lang: 'en-US', useYear: true }];

  const typeOrder = season !== null ? ['tv'] : ['tv', 'movie'];

  let keyIdx = 0;
  for (const s of strategies) {
    for (const type of typeOrder) {
      const results = await searchTmdb(cleanName, type, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length);
      keyIdx++;
      if (!results?.length) continue;

      // 遍历 top5，找到第一个满足置信度阈值的
      for (const result of results) {
        const score = confidenceScore(cleanName, result, s.lang, s.useYear ? year : undefined);
        if (score >= MIN_CONFIDENCE) {
          return {
            id: String(result.id),
            tmdb_type: type,
            poster: result.poster_path ? `${TMDB_IMG}${result.poster_path}` : '',
            title: result.title || result.name || cleanName,
            vote: result.vote_average || 0,
            year: (result.release_date || result.first_air_date || '').slice(0, 4) || year,
          };
        }
      }
      // 有结果但全部置信度不足，继续试下一个策略
    }
  }
  return 'NOMATCH';
}

async function cacheIt(r, sql) {
  if (DRY_RUN) return;
  try {
    await sql`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)
      VALUES (${r.id}, ${r.tmdb_type}, ${r.title}, ${''}, ${''}, ${r.poster}, ${r.vote}, ${0}, ${r.year || null}, ${null}, ${''}, ${[]}, NOW())
      ON CONFLICT (tmdb_id) DO UPDATE SET title = EXCLUDED.title, poster_path = EXCLUDED.poster_path, vote_average = EXCLUDED.vote_average, cached_at = NOW(), genres = EXCLUDED.genres
    `;
  } catch (e) {
    console.warn(`[cache] failed for ${r.id}: ${e.message}`);
  }
}

// ─── 主流程 ───────────────────────────────────────────────────────────────────
const tmdbLimiter = new RateLimiter();

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('[match] ERROR: DATABASE_URL not set');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT id, name, link, category, source
    FROM xx_resources
    WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH' OR tmdb_id = 'GARBLED')
      AND status = 'active'
      AND name IS NOT NULL
      AND LENGTH(name) > 2
      AND category NOT IN ('学习资料', '音乐', '纪录片', '其他', '演唱会', '体育赛事', '少儿频道', '合集')
    ORDER BY id
    LIMIT ${BATCH_SIZE}
  `;

  if (!rows.length) {
    console.log('[match] DONE: no unmatched records');
    process.exit(0);
  }

  console.log(`[match] Fetched ${rows.length} records, processing...`);

  const links = rows.filter(r => r.link).map(r => r.link);
  let linkMap = {};
  if (links.length > 0) {
    const existing = await sql`
      SELECT link, tmdb_id FROM xx_resources
      WHERE link = ANY(${links}) AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('GARBLED', 'NOMATCH')
    `;
    for (const r of existing) linkMap[r.link] = r.tmdb_id;
  }

  const CONCURRENCY = 20;
  const results = [];
  let totalMatched = 0;
  let totalNomatch = 0;
  let totalGarbled = 0;
  let totalReused = 0;
  let totalFailed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (item) => {
        if (item.link && linkMap[item.link]) {
          if (!DRY_RUN) {
            await sql`UPDATE xx_resources SET tmdb_id = ${linkMap[item.link]}, updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
          }
          return { id: item.id, tmdb_id: linkMap[item.link], reused: true };
        }

        const result = await matchOne(item.name);

        if (result === 'GARBLED') {
          if (!DRY_RUN) {
            await sql`UPDATE xx_resources SET tmdb_id = 'GARBLED', updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
          }
          return { id: item.id, tmdb_id: 'GARBLED' };
        }
        if (result === 'NOMATCH') {
          if (!DRY_RUN) {
            await sql`UPDATE xx_resources SET tmdb_id = 'NOMATCH', updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
          }
          return { id: item.id, tmdb_id: 'NOMATCH' };
        }
        if (result) {
          if (!DRY_RUN) {
            await sql`UPDATE xx_resources SET tmdb_id = ${result.id}, updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            await cacheIt(result, sql);
          }
          return { id: item.id, tmdb_id: result.id };
        }
        return { id: item.id, tmdb_id: null };
      })
    );

    results.push(...chunkResults);

    const chunkMatched = chunkResults.filter(r => r.tmdb_id && r.tmdb_id !== 'GARBLED' && r.tmdb_id !== 'NOMATCH').length;
    const chunkNomatch = chunkResults.filter(r => r.tmdb_id === 'NOMATCH').length;
    const chunkGarbled = chunkResults.filter(r => r.tmdb_id === 'GARBLED').length;
    const chunkReused = chunkResults.filter(r => r.reused).length;

    totalMatched += chunkMatched;
    totalNomatch += chunkNomatch;
    totalGarbled += chunkGarbled;
    totalReused += chunkReused;

    console.log(`[match] chunk ${i}-${i + chunk.length}: matched=${chunkMatched} nomatch=${chunkNomatch} garbled=${chunkGarbled} reused=${chunkReused}`);

    if (i + CONCURRENCY < rows.length) await sleep(100);
  }

  console.log(`[match] BATCH DONE: processed=${rows.length} matched=${totalMatched} nomatch=${totalNomatch} garbled=${totalGarbled} reused=${totalReused}`);
  process.exit(0);
}

main().catch(e => {
  console.error('[match] FATAL:', e.message);
  process.exit(1);
});