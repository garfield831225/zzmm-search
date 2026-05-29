/**
 * TMDB 批量匹配脚本
 * 本地运行: DATABASE_URL=xxx TMDB_API_KEY_1=xxx TMDB_API_KEY_2=xxx DRY_RUN=true DEBUG=true node scripts/match-tmdb.mjs
 * GitHub Actions: 自动从 secrets 读取环境变量
 *
 * 环境变量:
 *   DATABASE_URL      - Neon 连接串
 *   TMDB_API_KEY_1   - TMDB API Key 1
 *   TMDB_API_KEY_2   - TMDB API Key 2
 *   BATCH_SIZE        - 每批处理数量 (默认3000，DRY_RUN时默认20)
 *   DRY_RUN           - true=只测试不写入 (默认false)
 *   DEBUG             - true=打印每条记录的匹配过程 (DRY_RUN时自动开启)
 */

import { neon } from '@neondatabase/serverless';
import { execFile } from 'child_process';
import { promisify } from 'util';

const CURL = 'C:/Windows/System32/curl.exe';
const execFileAsync = promisify(execFile);

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// HTTP proxy (Clash Verge mixed-port 7897) - curl 能走，Node fetch 不行
const HTTP_PROXY = process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
const USE_PROXY = !!HTTP_PROXY;

// curl 替代 fetch（Node fetch 对 HttpsProxyAgent 兼容性问题）
async function curlFetch(url) {
  const args = USE_PROXY ? ['-x', HTTP_PROXY, '-s', '--connect-timeout', '10'] : ['-s', '--connect-timeout', '10'];
  try {
    const { stdout, stderr } = await execFileAsync(CURL, [...args, url]);
    if (!stdout || stdout.length < 10) return {};
    return JSON.parse(stdout);
  } catch (e) {
    // execFileAsync 在 stderr 有内容时也会 reject，但实际数据在 stdout
    // fallback: 重试不用 proxy
    if (USE_PROXY) {
      try {
        const { stdout } = await execFileAsync(CURL, ['-s', '--connect-timeout', '10', url]);
        return JSON.parse(stdout || '{}');
      } catch { return {}; }
    }
    return {};
  }
}

const DRY_RUN = process.env.DRY_RUN === 'true';
const DEBUG = process.env.DEBUG === 'true' || DRY_RUN;
const BATCH_SIZE = DRY_RUN ? 20 : (parseInt(process.env.BATCH_SIZE) || 3000);

console.log(`[match] Starting batch=${BATCH_SIZE} dry_run=${DRY_RUN} debug=${DEBUG}`);

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
  // ★ Bug fix 5: PT站格式优先提取中文部分
  // 格式: [中文名_英文名_年份]Season → 先取方括号内中文部分作搜索词
  let searchTitle = folderName;
  const ptMatch = folderName.match(/^\[([^\]]+)\]/);
  if (ptMatch) {
    const parts = ptMatch[1].split('_');
    const chinesePart = parts.find(p => /[\u4e00-\u9fff]/.test(p));
    if (chinesePart) searchTitle = chinesePart;
  }

  // ★ Bug fix 6: 年份只作搜索参数，不从标题删除
  let extractedYear = '';
  const yearCandidates = [...searchTitle.matchAll(/\b(20\d{2})\b/g)];
  for (const m of yearCandidates) {
    const y = parseInt(m[1]);
    if (y >= 1900 && y <= 2030) { extractedYear = m[1]; break; }
  }

  let season = null;
  const seasonPatterns = [/第([一二三四五六七八九十\d]+)季/i, /Season\s*(\d+)/i, /S(\d{1,2})E\d+/i, /S(\d{1,2})$/i];
  for (const pat of seasonPatterns) {
    const m = searchTitle.match(pat);
    if (m) { season = chineseToNumber(m[1]); break; }
  }

  let cleanName = searchTitle
    .replace(/第[一二三四五六七八九十\d]+季/gi, '')
    .replace(/Season\s*\d+/gi, '')
    .replace(/S\d{1,2}E\d+/gi, '')
    .replace(/S\d{1,2}$/gi, '')
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

  // Bug fix 6: 不再强制删除年份数字，只去掉扩展名
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
 * Bug fix: 1) 砍掉快速通道 2) 阈值 0.3→0.5 3) substring hit 改为加分项
 */
function confidenceScore(cleanName, tmdbResult, searchLang, searchYear) {
  // 清理后太短的不匹配（避免随机字符产生虚假相似度）
  const cleanLen = cleanName.replace(/\s/g, '').length;
  if (cleanLen < 3) return 0;

  const zhNames = [tmdbResult.title, tmdbResult.original_title, tmdbResult.name].filter(Boolean);
  const enName = (tmdbResult.title?.match(/[a-zA-Z]/) ? tmdbResult.title : '') || '';

  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const cleanNorm = norm(cleanName);
  const allTitles = [...zhNames, enName].map(t => ({ raw: t, norm: norm(t) }));

  // bigram 相似度
  const zhScore = Math.max(...zhNames.map(zn => titleSimilarity(cleanName, zn)));
  const enScore = enName ? titleSimilarity(cleanName, enName) : 0;
  let bestScore = Math.max(zhScore, enScore);

  // ★ Bug fix 3: substring hit 改为加分项，不是必要条件
  let substringBonus = 0;
  for (const t of allTitles) {
    if (t.norm.length >= 2 && (t.norm.includes(cleanNorm) || cleanNorm.includes(t.norm))) {
      substringBonus = 0.1;
      break;
    }
  }

  // ★ Bug fix 2: 阈值 0.3→0.5，精确匹配加分
  // 精确匹配：cleanName === title → 1.0，cleanName 包含于 title → 0.85
  let exactBonus = 0;
  for (const t of allTitles) {
    if (t.raw === cleanName) { exactBonus = 1.0; break; }
  }
  if (exactBonus === 0) {
    for (const t of allTitles) {
      if (t.norm.includes(cleanNorm) || cleanNorm.includes(t.norm)) { exactBonus = 0.85; break; }
    }
  }

  // 应用精确匹配加成
  if (exactBonus > 0) bestScore = Math.max(bestScore, exactBonus);

  // ★ Bug fix 1: 所有结果都必须过置信度，无快速通道
  // 年份一致性奖励（误差 ±2 年）
  let yearBonus = 0;
  const resultYear = (tmdbResult.release_date || tmdbResult.first_air_date || '').slice(0, 4);
  if (searchYear && resultYear && Math.abs(parseInt(resultYear) - parseInt(searchYear)) <= 2) {
    yearBonus = 0.1;
  }

  return bestScore + substringBonus + yearBonus;
}

// 最低接受阈值（bigram ≥ 0.5）
const MIN_CONFIDENCE = 0.5;

async function searchTmdb(name, type, year, lang, keyIndex) {
  await tmdbLimiter.wait(keyIndex);
  const endpoint = type === 'tv' ? '/search/tv' : '/search/movie';
  const yearParam = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
  let url = `${TMDB_BASE}${endpoint}?query=${encodeURIComponent(name)}&api_key=${TMDB_KEYS[keyIndex]}&language=${lang}${yearParam}&page=1&include_adult=false`;

  try {
    // 用 curl 替代 fetch（代理兼容性更好）
    const data = await curlFetch(url);
    const top5 = data.results?.slice(0, 5) || [];
    if (DEBUG) {
      const entries = top5.map(r => `"${(r.title||r.name||'').slice(0,20)}"(${r.release_date||r.first_air_date||'?'})`).join(' | ');
      console.log(`[TMDB] query="${name}" type=${type} lang=${lang} year=${year||'none'} → ${top5.length}: ${entries||'(empty)'}`);
    }
    return top5;
  } catch (e) {
    if (DEBUG) console.log(`[TMDB-ERR] query="${name}" error=${e.message}`);
    return null;
  }
}

async function matchOne(rawName) {
  if (isGarbled(rawName)) { if (DEBUG) console.log(`[DEBUG] GARBLED raw="${rawName}"`); return 0; }

  // ★ Bug fix 5: PT站格式支持 - 先尝试提取中文名
  let searchName = rawName;
  const ptMatch = rawName.match(/^\[([^\]]+)\]/);
  if (ptMatch) {
    const parts = ptMatch[1].split('_');
    const chinesePart = parts.find(p => /[\u4e00-\u9fff]/.test(p));
    if (chinesePart) searchName = chinesePart;
  }

  // 按 [] 拆成多段，每段单独搜 TMDB，取最佳结果
  const segments = searchName.split(/[\[\]]/).filter(s => s.trim().length >= 2);
  if (segments.length === 0) return 0;

  let bestResult = null;
  let bestScore = -1;

  for (const seg of segments) {
    const segResult = await matchSegment(seg.trim());
    if (segResult && typeof segResult === 'object' && segResult.score > bestScore) {
      bestScore = segResult.score;
      bestResult = {
        id: segResult.id,
        tmdb_type: segResult.tmdb_type,
        poster: segResult.poster,
        title: segResult.title,
        vote: segResult.vote,
        year: segResult.year,
      };
    }
  }

  if (bestResult) {
    if (DEBUG) console.log(`[DEBUG] MATCHED raw="${rawName}" → "${bestResult.title}" (tmdb_id=${bestResult.id} score=${bestResult.score.toFixed(3)})`);
    return bestResult;
  }
  if (DEBUG) console.log(`[DEBUG] NOMATCH raw="${rawName}"`);
  return 0;
}

// 对单个片段进行匹配
// Bug fix 7: 简化搜索顺序 + movie↔tv 互搜
async function matchSegment(segName) {
  const { cleanName, year, season } = cleanFolderName(segName);
  if (cleanName.length < 2) return null;

  const isEng = isEnglishName(cleanName);
  // 简化：先主语言，再备语言搜
  const strategies = isEng
    ? [{ lang: 'en-US', useYear: true }, { lang: 'en-US', useYear: false }, { lang: 'zh-CN', useYear: false }]
    : [{ lang: 'zh-CN', useYear: true }, { lang: 'zh-CN', useYear: false }, { lang: 'en-US', useYear: false }];

  // Bug fix 7: 初始类型由 season 决定，有结果就返回；没结果再互搜
  const typeOrder = season !== null ? ['tv'] : ['movie', 'tv'];

  let keyIdx = 0;
  for (const s of strategies) {
    for (const type of typeOrder) {
      const results = await searchTmdb(cleanName, type, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length);
      keyIdx++;
      if (!results?.length) continue;

      // 置信度筛选
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
            score,
          };
        }
      }
    }
  }
  return null;
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
    WHERE (tmdb_id IS NULL OR CAST(tmdb_id AS INTEGER) = 0 OR CAST(tmdb_id AS TEXT) IN ('NOMATCH', 'GARBLED', ''))
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
      WHERE link = ANY(${links}) AND tmdb_id IS NOT NULL AND CAST(tmdb_id AS TEXT) NOT IN ('GARBLED', 'NOMATCH', '') AND CAST(tmdb_id AS INTEGER) > 0
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

        if (result === 0) {
          if (!DRY_RUN) {
            await sql`UPDATE xx_resources SET tmdb_id = 0, updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
          }
          return { id: item.id, tmdb_id: 0 };
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

    const chunkMatched = chunkResults.filter(r => r.tmdb_id && r.tmdb_id !== 0).length;
    const chunkReused = chunkResults.filter(r => r.reused).length;

    totalMatched += chunkMatched;
    totalReused += chunkReused;

    console.log(`[match] chunk ${i}-${i + chunk.length}: matched=${chunkMatched} nomatch=${chunkResults.filter(r => r.tmdb_id === 0).length} reused=${chunkReused}`);

    if (i + CONCURRENCY < rows.length) await sleep(100);
  }

  console.log(`[match] BATCH DONE: processed=${rows.length} matched=${totalMatched} nomatch=${rows.length - totalMatched - totalReused} reused=${totalReused}`);
  process.exit(0);
}

main().catch(e => {
  console.error('[match] FATAL:', e.message);
  process.exit(1);
});