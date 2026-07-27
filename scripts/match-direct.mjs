/**
 * match-direct.mjs — 2026-07-23 V3
 *
 * NAS 上独立跑 TMDB 批量匹配, 走 Windows Clash HTTP 代理绕 GFW
 * 2026-07-23: Vercel DEPLOYMENT_DISABLED 后改走 NAS 路线
 *
 * 用法:
 *   node scripts/match-direct.mjs --batch 500 --max-rounds 50
 *
 * 环境变量 (.env.production):
 *   HTTP_PROXY = http://192.168.3.3:7897
 *   DATABASE_URL = postgresql://...
 *   TMDB_API_KEY_1 / TMDB_API_KEY_2 = ...
 */

import { appendFileSync, writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { ProxyAgent, setGlobalDispatcher, Agent } from 'undici';
import { neon } from '@neondatabase/serverless';

// ─── 简单 .env 解析 ──────────────────────────────────────────────────────────
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const line of content.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
loadEnvFile(process.env.ENV_FILE || '/app/.env.production');
loadEnvFile('.env.production');

// ─── 代理设置 ────────────────────────────────────────────────────────────────
const PROXY_URL = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://192.168.3.3:7897';
const NO_PROXY_HOSTS = process.env.NO_PROXY || 'localhost,127.0.0.1,neon.tech,aws.neon.tech,ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech';

if (PROXY_URL) {
  try {
    setGlobalDispatcher(new ProxyAgent({ uri: PROXY_URL }));
  } catch (e) {}
}

// ─── 参数 ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name, def) {
  const i = args.indexOf(name);
  if (i >= 0 && i + 1 < args.length) return args[i + 1];
  return def;
}
function hasFlag(name) { return args.includes(name); }

const BATCH_SIZE = parseInt(getArg('--batch', '500'));
const MAX_ROUNDS = parseInt(getArg('--max-rounds', '50'));
const INTERVAL_MS = parseInt(getArg('--interval', '1000'));
const DRY_RUN = hasFlag('--dry-run');
const LOG_FILE = getArg('--log', '/app/logs/match.log');
const PID_FILE = getArg('--pid', '/app/logs/match.pid');

// 写 PID
try {
  const dir = dirname(PID_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PID_FILE, String(process.pid));
} catch (e) {}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { appendFileSync(LOG_FILE, line); } catch {}
  console.log(JSON.stringify({ ts: Date.now(), msg: String(msg) }));
}

if (!process.env.DATABASE_URL) {
  log('FATAL: DATABASE_URL not set');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const TMDB_KEYS = [
  process.env.TMDB_API_KEY_1 || process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd',
  process.env.TMDB_API_KEY_2 || '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

log(`start: batch=${BATCH_SIZE} max_rounds=${MAX_ROUNDS} interval=${INTERVAL_MS}ms pid=${process.pid} proxy=${PROXY_URL}`);

// ─── 速率限制 ────────────────────────────────────────────────────────────────
class RateLimiter {
  constructor() { this.lastCalls = TMDB_KEYS.map(() => 0); this.minInterval = 50; }
  async wait(keyIndex) {
    const now = Date.now();
    const wait = Math.max(0, this.lastCalls[keyIndex] + this.minInterval - now);
    if (wait > 0) await sleep(wait);
    this.lastCalls[keyIndex] = Date.now();
  }
}
const tmdbLimiter = new RateLimiter();

// ─── 辅助函数 ────────────────────────────────────────────────────────────────
function chineseToNumber(str) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}
function isEnglishName(name) { return /^[a-zA-Z\s\d.'-]+$/.test(name.trim()); }
function isGarbled(name) {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i);
    if (cp === 0xfffd) { garbageLen++; continue; }
    if (cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}
function subTypeToTmdb(subType) {
  if (!subType) return 'movie';
  const s = subType.toLowerCase();
  // 2026-07-27: 补 动漫/综艺/纪录片/少儿 等子类型 → 都是 tv
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}

const BAD_STATUSES = { tv: ['In Production', 'Planned'], movie: ['In Production', 'Planned'] };
function isStatusOk(type, status) {
  if (!status) return true;
  return !(BAD_STATUSES[type] || []).includes(status);
}

function cleanFolderName(raw) {
  // 2026-07-23 改进:
  //   1) 剥掉 ? 问号 (1080p? 这种)
  //   2) 剥掉 (YYYY) 在任意位置
  //   3) 剥掉 1080p/720p/4K/8K 嵌入式
  //   4) 短名 (< 2 字符) 标记为 NOMATCH
  //   5) ISO 文件多括号时, 优先取有中文的

  // 全局预处理
  let pre = raw
    .replace(/\?/g, ' ')              // 问号 → 空格
    .replace(/[（(]\s*\d{4}\s*[)）]/g, ' ')  // 任意位置的 (YYYY)
    .replace(/\b(2160p|1080p|720p|480p|4K|8K|UHD|HDTV|WEB-?DL|BluRay|BDRemux|REMUX)\b/gi, ' ')  // 嵌入式分辨率
    .replace(/\s{2,}/g, ' ')
    .trim();

  // 从原始 raw 提取 year (在预处理前, 避免 (YYYY) 被剥)
  let year = '';
  const yearMatchEarly = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatchEarly) { const y = parseInt(yearMatchEarly[1]); if (y >= 1900 && y <= 2030) year = String(y); }

  if (pre.endsWith('.iso')) {
    const firstBracket = pre.match(/^\[([^\]]+)\]/);
    if (firstBracket) {
      let extracted = firstBracket[1];
      if (!/[\u4e00-\u9fff]/.test(extracted)) {
        const allBrackets = [...pre.matchAll(/\[([^\]]+)\]/g)];
        if (allBrackets.length >= 2) extracted = allBrackets[1][1];
      }
      extracted = extracted.replace(/\s*\d{4}(?=\W|$)/, '').trim();
      extracted = extracted.replace(/^(4K|8K|2160p|1080p|720p|DIY|CEE|美版|日版|港版|欧版|韩版|台版|DV|HDR|Dolby|Atmos|DTS|HEVC|LPCM)\s*/i, '');
      if (extracted.length >= 2) return { cleanName: extracted, year, season: null };
    }
  }
  // 用 preprocessed 字符串 (剥掉 ? + 嵌入式 1080p)
  raw = pre;
  raw = raw.replace(/\s*\( ?\d{4} ?\)\s*$/, '').replace(/\s*（ ?\d{4} ?）\s*$/, '').trim();
  let season = null;
  const seasonMatch = raw.match(/第([一二三四五六七八九十\d]+)季|S(\d{1,2})/i);
  if (seasonMatch) season = seasonMatch[1] ? chineseToNumber(seasonMatch[1]) : parseInt(seasonMatch[2]);
  raw = raw
    .replace(/第[一二三四五六七八九十\d]+季/g, '')
    .replace(/S\d{1,2}(?=[^\d]|$)/gi, '')
    .replace(/Season\s*\d{1,2}/gi, '')
    .replace(/[（(]\s*\d{4}\s*[)）]/g, '')
    .replace(/\s+(杜比视界|杜比音效|Dolby\s*Vision|Dolby\s*Atmos|IMAX\s*Enhanced|IMAX|4K\s*修复|导演剪辑版?|终极版|加长版|特别版|抢先版|正式版|国语配音|国配|港版|台版|美版|日版|韩版|欧版|东南亚版|英版|重制版|修复版|高码|高码率)\s*$/i, '')
    .replace(/\s{2,}/g, ' ').trim();
  const firstDot = raw.indexOf('.');
  if (firstDot > 0 && firstDot < 20) {
    const beforeDot = raw.slice(0, firstDot).trim();
    const afterDot = raw.slice(firstDot + 1);
    if (!(beforeDot.length >= 2 && beforeDot.length <= 5 && /[\u4e00-\u9fff]/.test(beforeDot) && /^(19\d{2}|20\d{2})$/i.test(afterDot))) {
      if (beforeDot.length >= 2 && /[\u4e00-\u9fff]/.test(beforeDot)) {
        return { cleanName: beforeDot, year, season };
      }
    }
  }
  const ptMatch = raw.match(/^\[([^\]]+)\]/);
  if (ptMatch) {
    const parts = ptMatch[1].split('_');
    const chinese = parts.find(p => /[\u4e00-\u9fff]/.test(p));
    if (chinese) {
      let t = chinese.replace(/第\d+季/i, '').replace(/\s*\d{4}$/, '').trim();
      if (t) return { cleanName: t, year, season };
    }
    const dotInBrackets = ptMatch[1].match(/^([^_\.]+)/);
    if (dotInBrackets) {
      let t = dotInBrackets[1].trim();
      if (t.endsWith('.')) t = t.slice(0, -1);
      if (t.length >= 2 && /[\u4e00-\u9fff]/.test(t)) {
        return { cleanName: t, year, season };
      }
    }
  }
  const multiBrackets = [...raw.matchAll(/\[([^\]]+)\]/g)];
  for (const m of multiBrackets) {
    const content = m[1].trim();
    if (content.length >= 2 && /[\u4e00-\u9fff]/.test(content)) {
      const lower = content.toLowerCase();
      if (/^(4k|8k|2160p|1080p|720p|480p|blu-?ray|bluray|bdmv|remux|web-?dl|hdtv|diy|cee|美版|日版|港版|欧版|韩版|台版|hdr10|hdr|dolby|dts|atmos|truehd|aac|dts-?hd|ac3|imax|sdr|国语|英语|粤语|中字|字幕|配音|特效|简繁|双语)$/i.test(content)) continue;
      if (/^(4k|8k|2160p|1080p|720p|480p|blu-?ray|bluray|bdmv|remux|web-?dl|hdtv)\s/i.test(content)) continue;
      if (/^(19\d{2}|20\d{2})\s*$/i.test(content)) continue;
      let t = content.replace(/\d{1,2}\.\d+G$/, '').trim();
      if (t && t.length >= 2) return { cleanName: t, year, season };
    }
  }
  const dotParts = raw.split('.');
  for (const part of dotParts) {
    const p = part.trim();
    if (p.length >= 2 && /[\u4e00-\u9fff]/.test(p)) {
      if (!/^(19\d{2}|20\d{2}|4K|8K|蓝光原盘|蓝光remux|HDTV|WEBRip|BluRay|DIY)$/i.test(p)) {
        return { cleanName: p, year, season };
      }
    }
  }
  const bookMatch = raw.match(/《([^》]+)》/);
  if (bookMatch) {
    const content = bookMatch[1].trim();
    if (content.length >= 2) {
      let t = content.replace(/\s*(19\d{2}|20\d{2})\s*/g, ' ').replace(/\s*(4K|蓝光原盘|蓝光|HDTV|WEBRip)\s*/gi, ' ').trim();
      if (t) return { cleanName: t, year, season };
    }
  }
  const parenMatch = raw.match(/[（(]([^）)]+)[)）]/);
  if (parenMatch) {
    const content = parenMatch[1].trim();
    if (content.length >= 2 && /[\u4e00-\u9fff]/.test(content)) {
      return { cleanName: content, year, season };
    }
  }
  const chineseFragments = raw.match(/[\u4e00-\u9fff][^\[\]（）【】《》\s]{0,30}/g);
  if (chineseFragments && chineseFragments.length > 0) {
    let best = '';
    for (const frag of chineseFragments) {
      if (frag.length > best.length && frag.length >= 2) best = frag.trim();
    }
    if (best) return { cleanName: best, year, season };
  }
  const trimmed = raw.replace(/^[\[\]（）【】《》\s]+|[\[\]（）【】《》\s]+$/g, '').trim();
  if (trimmed.length >= 2 && !/[\u4e00-\u9fff]/.test(trimmed)) {
    // 2026-07-27: 纯英文场景再清洗一遍 (剥 . 分隔的短修饰词, Blu-ray/HEVC/USA/UHD/1080p 等)
    // 比如 "The.Summer.Hikaru.Died.. .JPN.Blu-ray.AVC.LPCM.2.0-NA" → "The Summer Hikaru Died"
    const t = trimmed
      .split(/[.\s_\-]+/)  // 按 . 空格 _ - 切
      .map(s => s.trim())
      .filter(s => {
        if (!s) return false;
        if (/^\d{1,2}\.\d+G$/.test(s)) return false; // 5.1 / 7.1 等
        if (/^(19\d{2}|20\d{2})$/i.test(s)) return false; // 年份
        if (/^(4k|8k|2160p|1080p|720p|480p|bluray|blu-ray|bdmv|remux|web-?dl|hdtv|webrip|hdr10\+?|hdr|dv|dovi|hevc|avc|x264|x265|h\.?264|h\.?265|10bit|atmos|truehd|dts-?hd|dts|dts-hd|ma\d|pcm|lpcm|ac3|aac|mp3|flac|ddp|dd5\.?1|dd7\.?1|2\.0|5\.1|7\.1|usa|uk|jp|kr|cn|eu|fr|de|hk|tw|bd|cd|dvd|iso|uhd|hd|sdr|qpel|xvid|divx|complete|criterion|extended|director|edition|theatrical|uncut|remastered|proper|repack|limited|dual|audio|multi|subs?|nfo|sample|cover|jpg|png|web|netflix|amazon|disney|appletv|hulu|paramount|sony|warners?|universal|fox|mill creek|arrow|criterion|shout|factory|vinegar|kino|lions|gate|IMDb|Blu-ray|BDRip|BRRip|remaster|multi)$/i.test(s)) return false;
        if (s.length === 1) return false;
        if (s.length <= 2 && !/[A-Z]/.test(s)) return false; // 单字符 + 双字符小写不要
        return true;
      })
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // 2026-07-27: 再剥 stopword (a/the/in) + tracker + 短词 (JPN/NA), 严格 ≥ 4 字符
    if (t.length >= 2) {
      const STOP2 = /^(the|a|an|and|or|of|in|on|at|to|for|by|with|from|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|should|could|may|might|can|must|na|no|oh|my|his|her|its|our|your|their|i|me|you|he|she|we|they|them|us|him|this|that|these|those|some|any|all|each|every|most|more|less|very|just|only|also|even|still|too|so|if|then|than|as|but|not|n't|jp|kr|us|uk|cn|hk|tw|eu|na|au|ca|fr|de|it|es|ru|in|br|mx|jp0|kr0|us0|uk0|cn0|hk0|tw0|na0|ray|blu|nyaa|0chd|cmct|hdsky|ourbits|chdbits|hdc|tjupt|hdt|lemonhd|hds|frds|beast|tsdm|fresh|pub|web|netflix|disney|amzn|hulu|appletv|n0|n1|nan|nan0|nan1|ntsc|pal|secam)$/i;
      const t2 = t
        .split(/\s+/)
        .map(s => s.replace(/[.,;:!?'"()\[\]{}]/g, '').trim())
        .filter(s => s.length >= 4)
        .filter(s => !STOP2.test(s))
        .filter(s => !/@/.test(s))
        .filter(s => !/^\d+$/.test(s))
        .join(' ')
        .trim();
      if (t2.length >= 2) {
        return { cleanName: t2, year, season };
      }
      return { cleanName: t, year, season };
    }
    return { cleanName: trimmed, year, season };
  }
  const afterStrip = raw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (afterStrip.length >= 2 && /[\u4e00-\u9fff]/.test(afterStrip)) return { cleanName: afterStrip, year, season };
  let t = raw
    .replace(/\[[^\]]*\]/g, ' ').replace(/[（(][^）)]*[)）]/g, ' ')
    .replace(/《[^》]*》/g, ' ').replace(/【[^】]*】/g, ' ')
    .replace(/\d{1,2}\.\d+G$/, '').replace(/\b(19\d{2}|20\d{2})\b/g, ' ')
    .replace(/\b(4K|8K|1080p|2160p|720p|480p)\b/gi, ' ')
    .replace(/\b(Bluray|BluRay|BDMV|WEB-DL|REMUX|DIY|CEE|美版|日版|港版|欧版|韩版|台版)\b/gi, ' ')
    .replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length < 2) t = raw;
  t = t.replace(/第[一二三四五六七八九十\d]+季/g, '').replace(/\s+/g, ' ').trim();
  return { cleanName: t, year, season };
}

async function searchTmdb(name, type, category, year, lang = 'zh-CN', keyIndex = 0, useYear = false) {
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
    const candidates = [];
    for (const r of data.results) {
      const status = r.status || (type === 'tv' ? r.status || 'Unknown' : r.release_date ? 'Released' : 'Unknown');
      if (!isStatusOk(type, status)) continue;
      candidates.push({ result: r, status });
      if (candidates.length >= 8) break;
    }
    if (candidates.length === 0) return null;

    // 2026-07-27 用户拍板: "title 那列不能作为匹配依据么?? 剥离那么差么!!!!"
    // 1 个候选就是它 (仅 useYear=true 时接受, useYear=false 是兜底不能 1 候选就接受)
    // year 校验: 候选的 release_date 必须跟用户提供的 year 一致 (±2 年)
    if (candidates.length === 1 && useYear) {
      if (year) {
        const releaseYear = (candidates[0].result.release_date || candidates[0].result.first_air_date || '').slice(0, 4);
        if (releaseYear && Math.abs(parseInt(releaseYear) - parseInt(year)) > 2) {
          return null;
        }
      }
      return { ...candidates[0].result, tmdb_status: candidates[0].status };
    }

    // 多个候选: 如果用户给了 year, 先按 year 过滤 (release_date year ±2 范围内)
    let filtered = candidates;
    if (year) {
      filtered = candidates.filter(c => {
        const ry = (c.result.release_date || c.result.first_air_date || '').slice(0, 4);
        return !ry || Math.abs(parseInt(ry) - parseInt(year)) <= 2;
      });
      if (filtered.length === 0) filtered = candidates;
      if (filtered.length === 1) return { ...filtered[0].result, tmdb_status: filtered[0].status };
    }

    const norm = (s) => s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
    const cn = norm(name);
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.length === cn.length && tn === cn) return { ...c.result, tmdb_status: c.status };
    }
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.includes(cn) && cn.length >= 2 && tn.length - cn.length <= 6) return { ...c.result, tmdb_status: c.status };
    }
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.startsWith(cn) && cn.length >= 2) return { ...c.result, tmdb_status: c.status };
    }
    // 2026-07-27: token 全包含匹配 (剥 stopword), 解决 "The Summer Hikaru Died" vs "Summer Hikaru Died" 问题
    const STOP_EN = /\b(the|a|an|and|or|of|in|on|at|to|for|by|with|from|is|are|was|were|be|been|being|have|has|had|do|does|did|will|would|may|might|can|must|i|me|you|he|she|we|they|this|that|some|any|all|no)\b/gi;
    const tokens = (s) => s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2 && !STOP_EN.test(t));
    const cnTokens = tokens(name);
    if (cnTokens.length >= 2) {
      for (const c of filtered) {
        const t = c.result.title || c.result.name || '';
        if (!t) continue;
        const tTokens = tokens(t);
        if (cnTokens.every(tok => tTokens.includes(tok))) {
          return { ...c.result, tmdb_status: c.status };
        }
      }
    }
    // 2026-07-27: 模糊编辑距离匹配 (中文同人不同字, 如 "侠盗石川" vs "大盗五右卫门")
    if (cn.length >= 2) {
      for (const c of filtered) {
        const t = c.result.title || c.result.name || '';
        if (!t) continue;
        const tn = norm(t);
        if (tn.length < 2) continue;
        const d = levenshtein(cn, tn);
        const maxLen = Math.max(cn.length, tn.length);
        const allow = Math.max(2, Math.floor(maxLen * 0.3));
        if (d <= allow) {
          return { ...c.result, tmdb_status: c.status };
        }
      }
    }
    // 多个候选 + 全不严格匹配 → useYear=true 才接受第 1 个, false 不接受
    if (!useYear) return null;
    return { ...filtered[0].result, tmdb_status: filtered[0].status };
  } catch (e) {
    return null;
  }
}

// 2026-07-27: Levenshtein 编辑距离 (中文 fuzzy 匹配)
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

async function matchOne(rawName, category, subType) {
  if (isGarbled(rawName)) return 'GARBLED';
  const tmdbMatch = rawName.match(/\{tmdb-(\d+)\}/);
  if (tmdbMatch) {
    const tmdbId = tmdbMatch[1];
    let tmdbType = 'movie';
    if (['剧集', '动漫', '综艺', '少儿频道'].includes(category)) tmdbType = 'tv';
    return { id: tmdbId, tmdb_type: tmdbType, poster: '', title: rawName.replace(/\s*\{tmdb-\d+\}/, '').trim(), vote: 0, year: '' };
  }

  // 2026-07-27: 用户拍板 - "title 那列不能作为匹配依据么?? 剥离那么差么!!!!"
  // 用户表的 name 字段 = 片名/标题, 直接搜 TMDB 就行, 不要瞎剥
  // 判定"是不是文件名字符串" (含 [xxx].iso/1080p/Blu-ray/HEVC 等典型特征) → 才走 cleanFolderName
  // 否则直接拿 rawName 当 cleanName (再小幅清洗掉 (YYYY) 等不影响匹配的修饰)
  const isFileNameString = /\[[^\]]+\]|\.iso|1080p|720p|2160p|480p|4K|8K|UHD|BDMV|Blu-?ray|REMUX|HDTV|WEB-?DL|HEVC|AVC|x\.?264|x\.?265|HDR10|Dolby|TrueHD|Atmos|DTS/i.test(rawName)
    || /[（(]\d{4}[)）]/.test(rawName)  // 含 (2024) 之类年份括号
    || /第[一二三四五六七八九十\d]+季|S\d{1,2}/i.test(rawName);  // 季号

  let cleanName, year, season;
  if (isFileNameString) {
    // 是文件名字符串 → 才走 cleanFolderName
    const r = cleanFolderName(rawName);
    cleanName = r.cleanName; year = r.year; season = r.season;
  } else {
    // 干净标题 → 只剥 (YYYY) 跟末尾季号, 不瞎剥
    cleanName = rawName
      .replace(/\s*[（(]\s*\d{4}\s*[)）]\s*$/g, '')  // 末尾 (2024) 剥
      .replace(/第[一二三四五六七八九十\d]+季.*$/g, '')  // 末尾"第X季"剥
      .replace(/\s*\{tmdb-\d+\}/g, '')
      .trim();
    // 提取年份
    const ym = cleanName.match(/[（(]\s*(19\d{2}|20\d{2})\s*[)）]/);
    year = ym ? ym[1] : '';
    if (year) cleanName = cleanName.replace(ym[0], '').trim();
    const sm = cleanName.match(/第([一二三四五六七八九十\d]+)季|S(\d{1,2})/i);
    season = sm ? (sm[1] ? chineseToNumber(sm[1]) : parseInt(sm[2])) : null;
    if (sm) cleanName = cleanName.replace(sm[0], '').trim();
  }

  if (!cleanName || cleanName.length < 2) return 'NOMATCH';
  if (cleanName.length > 80) cleanName = cleanName.slice(0, 80);  // 太长截断

  const isEng = isEnglishName(cleanName);
  const strategies = isEng
    ? [{ lang: 'en-US', useYear: true }, { lang: 'en-US', useYear: false }, { lang: 'zh-CN', useYear: true }]
    : [{ lang: 'zh-CN', useYear: true }, { lang: 'zh-CN', useYear: false }, { lang: 'en-US', useYear: true }];
  let typeOrder;
  if (category === '演唱会') typeOrder = ['movie', 'tv'];
  else if (category === '纪录片') typeOrder = ['tv', 'movie'];
  else if (subType) {
    const tmdbType = subTypeToTmdb(subType);
    typeOrder = [tmdbType, tmdbType === 'movie' ? 'tv' : 'movie'];
  }
  else if (['连载', '剧集', '动漫', '综艺', '少儿频道'].includes(category)) typeOrder = ['tv'];
  else if (['电影', '华语电影', '外语电影', '动画电影', 'REMUX', '系列电影'].includes(category)) typeOrder = ['movie', 'tv'];
  else if (season !== null) typeOrder = ['tv'];
  else typeOrder = ['movie', 'tv'];
  let keyIdx = 0;
  for (const s of strategies) {
    for (const type of typeOrder) {
      const result = await searchTmdb(cleanName, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length, s.useYear);
      keyIdx++;
      if (result) {
        return {
          id: String(result.id), tmdb_type: type,
          poster: result.poster_path ? `${TMDB_IMG}${result.poster_path}` : '',
          title: result.title || result.name || cleanName,
          vote: result.vote_average || 0,
          year: (result.release_date || result.first_air_date || '').slice(0, 4) || year,
        };
      }
    }
  }

  // 2026-07-27: 降级搜不带尾部数字/符号的版本 (续集匹配系列名)
  // "真人快打2" → "真人快打", "马达加斯加1+2" → "马达加斯加"
  let noTrailingNum = cleanName;
  for (let i = 0; i < 3; i++) {
    const next = noTrailingNum.replace(/[\s:：\-_+/&]?\d{1,3}\s*$/, '').trim();
    if (next === noTrailingNum) break;
    noTrailingNum = next;
  }
  if (noTrailingNum !== cleanName && noTrailingNum.length >= 2) {
    for (const s of strategies) {
      for (const type of typeOrder) {
        const result = await searchTmdb(noTrailingNum, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length, s.useYear);
        keyIdx++;
        if (result) {
          return {
            id: String(result.id), tmdb_type: type,
            poster: result.poster_path ? `${TMDB_IMG}${result.poster_path}` : '',
            title: result.title || result.name || cleanName,
            vote: result.vote_average || 0,
            year: (result.release_date || result.first_air_date || '').slice(0, 4) || year,
          };
        }
      }
    }
  }

  return 'NOMATCH';
}

async function cacheIt(r) {
  if (DRY_RUN) return;
  try {
    await sql`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)
      VALUES (${r.id}, ${r.tmdb_type}, ${r.title}, ${''}, ${''}, ${r.poster}, ${r.vote}, ${0}, ${r.year || null}, ${null}, ${''}, ${null}, NOW())
      ON CONFLICT (tmdb_id) DO UPDATE SET
        title = EXCLUDED.title,
        poster_path = EXCLUDED.poster_path,
        vote_average = EXCLUDED.vote_average,
        cached_at = NOW()
    `;
  } catch {}
}

// ─── 一轮 batch ──────────────────────────────────────────────────────────────
async function runOneBatch(batchSize) {
  try {
    // 2026-07-27: 修 SQL 条件 (用户报"匹配不上是你匹配有问题"):
    //   1) 去掉 `name ~ '[\u4e00-\u9fff]'` 限制 (纯英文资源也能进入 matcher, 走 en-US 策略)
    //   2) `LENGTH(TRIM(name)) > 1` 而不是 `LENGTH(name) > 5` (放过短名字)
    //   3) 加 `NOT (name ~ '[\x00-\x1F]')` 排除控制字符 (虽然 Neon 不会写入)
    //   4) `category NOT IN (...)` 保持, 不匹配 音乐/体育/合集 等
    // 2026-07-27: 优先跑易命中的 category (剧集/电影/动漫/纪录片), 原盘类重试率太低放最后
    //   同时 NOMATCH 的重试放最后 (已经试过没匹配到的, 别反复重试浪费 API)
    //   2026-07-27: 加上 created_at 优先 (新导入的资源立刻匹配, 不等老资源清完)
    const rows = await sql`
      SELECT id, name, link, category, source, sub_type
      FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active'
        AND name IS NOT NULL
        AND LENGTH(TRIM(name)) > 1
        AND category NOT IN ('音乐', '体育', '合集', '学习资料', '其他', '游戏', '电子书', '精品课', '文档')
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')
      ORDER BY
        CASE
          WHEN tmdb_id IN ('NOMATCH', 'GARBLED') THEN 1
          ELSE 0
        END,
        CASE
          WHEN category IN ('电影', '剧集', '动漫', '纪录片') THEN 0
          WHEN category IN ('演唱会', '连载') THEN 1
          ELSE 2
        END,
        -- 2026-07-27: 新插入的资源 (id 大) 优先 (用户期望新数据立刻出现)
        created_at DESC,
        id
      LIMIT ${batchSize}
    `;
    if (!rows.length) return { processed: 0, matched: 0, nomatch: 0, garbled: 0, reused: 0, failed: 0, done: true };

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
    const stats = { processed: rows.length, matched: 0, nomatch: 0, garbled: 0, reused: 0, failed: 0 };
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          if (item.link && linkMap[item.link]) {
            const reusedId = linkMap[item.link];
            if (!DRY_RUN) {
              await sql`UPDATE xx_resources SET tmdb_id = ${reusedId}, last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            }
            return { reused: true };
          }
          const result = await matchOne(item.name, item.category, item.sub_type || null);
          if (result === 'GARBLED') {
            if (!DRY_RUN) {
              await sql`UPDATE xx_resources SET tmdb_id = 'GARBLED', last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            }
            return { status: 'garbled' };
          }
          if (result === 'NOMATCH') {
            if (!DRY_RUN) {
              await sql`UPDATE xx_resources SET tmdb_id = 'NOMATCH', last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            }
            return { status: 'nomatch' };
          }
          if (result) {
            if (!DRY_RUN) {
              const upd = await sql`UPDATE xx_resources SET tmdb_id = ${result.id}, last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id} RETURNING id`.catch(() => []);
              if (!upd || !upd.length) return { status: 'failed' };
              await cacheIt(result);
            }
            return { matched: true };
          }
          return { status: 'failed' };
        })
      );
      for (const r of chunkResults) {
        if (r.reused) stats.reused++;
        else if (r.matched) stats.matched++;
        else if (r.status === 'garbled') stats.garbled++;
        else if (r.status === 'nomatch') stats.nomatch++;
        else stats.failed++;
      }
      if (i + CONCURRENCY < rows.length) await sleep(100);
    }
    return stats;
  } catch (e) {
    return { processed: 0, matched: 0, nomatch: 0, garbled: 0, reused: 0, failed: 0, error: e.message?.slice(0, 200) };
  }
}

// ─── 主循环 ──────────────────────────────────────────────────────────────────
let totalProcessed = 0, totalMatched = 0, totalNomatch = 0, totalGarbled = 0, totalReused = 0, totalFailed = 0;
let rounds = 0;

for (let i = 0; i < MAX_ROUNDS; i++) {
  rounds = i + 1;
  const data = await runOneBatch(BATCH_SIZE);
  if (data.error) {
    log(`round ${rounds}: err ${data.error}`);
    await sleep(5000);
    continue;
  }
  totalProcessed += data.processed;
  totalMatched += data.matched;
  totalNomatch += data.nomatch;
  totalGarbled += data.garbled;
  totalReused += data.reused;
  totalFailed += data.failed;
  log(`round ${rounds}: processed=${data.processed} matched=${data.matched} nomatch=${data.nomatch} garbled=${data.garbled} reused=${data.reused} failed=${data.failed} (累计: matched=${totalMatched}/${totalProcessed})`);
  if (data.done || data.processed === 0) {
    log('DONE: 没数据了');
    break;
  }
  if (i + 1 < MAX_ROUNDS) await sleep(INTERVAL_MS);
}

log(`FINAL: rounds=${rounds} processed=${totalProcessed} matched=${totalMatched} nomatch=${totalNomatch} garbled=${totalGarbled} reused=${totalReused} failed=${totalFailed}`);
process.exit(0);
