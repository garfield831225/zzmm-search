// 2026-08-12: TMDB 匹配核心引擎 (从 /api/admin/match/route.ts 抽出)
//   - cleanFolderName: 21 个 quality suffix 剥除 (杜比视界/IMAX/导演剪辑版/加长版/...)
//   - searchTmdb: 双 key 50 req/s 限速 (40 ms 间隔)
//   - matchOne: 4 个匹配 tier (1:1 / sub-string / prefix / bigram / Levenshtein)
//   - 续集降级 "真人快打2" → "真人快打"
//   - Returning Series 优先 (连载分类) vs Ended/Released (其他分类)
//   - 不调 getTmdbDetails (60s Vercel 限制) — search result 自带 status

const TMDB_KEYS = [
  '7985342d5961e9ee3d5ef6d969c1b8dd',
  '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// ─── 速率限制器（双 key 各 20 calls/sec，共 40 calls/sec，安全留 buffer）──
class RateLimiter {
  private lastCalls = TMDB_KEYS.map(() => 0);
  private readonly minInterval = 50;  // 20 calls/sec per key
  async wait(keyIndex: number) {
    const now = Date.now();
    const waitTime = Math.max(0, this.lastCalls[keyIndex] + this.minInterval - now);
    if (waitTime > 0) await new Promise(r => setTimeout(r, waitTime));
    this.lastCalls[keyIndex] = Date.now();
  }
}
const tmdbLimiter = new RateLimiter();

// ─── 辅助函数 ──────────────────────────────────────────────────────────

function chineseToNumber(str: string): number {
  const map: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}

function isEnglishName(name: string): boolean {
  return /^[a-zA-Z\s\d.'-]+$/.test(name.trim());
}

// 判断是否是乱码（垃圾字符密度超过40%才视为乱码）
export function isGarbled(name: string): boolean {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i)!;
    if (cp === 0xfffd) { garbageLen++; continue; }
    if (cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || [0x2e, 0xff0e, 0x3001, 0x3002, 0xff01, 0xff1f, 0x2018, 0x2019, 0xff08, 0xff09, 0x300a, 0x300b, 0x3008, 0x3009, 0x3010, 0x3011, 0x201c, 0x201d, 0xff5b, 0xff5d, 0x5b, 0x5d, 0x28, 0x29, 0x2d, 0x2e].includes(cp);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}

// 重写版 cleanFolderName (多策略提取)
export function cleanFolderName(raw: string): { cleanName: string; year: string; season: number | null } {
  // Step 0: ISO文件名优先从第一个方括号提取
  if (raw.endsWith('.iso')) {
    const firstBracket = raw.match(/^\[([^\]]+)\]/);
    if (firstBracket) {
      let extracted = firstBracket[1];
      if (!/[\u4e00-\u9fff]/.test(extracted)) {
        const allBrackets = Array.from(raw.matchAll(/\[([^\]]+)\]/g));
        if (allBrackets.length >= 2) extracted = allBrackets[1][1];
      }
      extracted = extracted.replace(/\s*\d{4}(?=\W|$)/, '').trim();
      extracted = extracted.replace(/^(4K|8K|2160p|1080p|720P|DIY|CEE|美版|日版|港版|欧版|韩版|台版|DV|HDR|Dolby|Atmos|DTS|HEVC|LPCM)\s*/i, '');
      if (extracted.length >= 2) return { cleanName: extracted, year: '', season: null };
    }
  }

  // 先去掉尾部 (年份) 或 （年份）后缀
  raw = raw.replace(/\s*\( ?\d{4} ?\)\s*$/, '').replace(/\s*（ ?\d{4} ?）\s*$/, '').trim();
  let title = raw;
  let year = '';
  const yearMatch = raw.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y >= 1900 && y <= 2030) year = String(y);
  }

  let season: number | null = null;
  const seasonMatch = raw.match(/第([一二三四五六七八九十\d]+)季|S(\d{1,2})/i);
  if (seasonMatch) {
    season = seasonMatch[1] ? chineseToNumber(seasonMatch[1]) : parseInt(seasonMatch[2]);
  }

  // 2026-06-03: 在主流程入口就剥掉「第X季」「Sxx」「(YYYY)」字样，避免干扰 TMDB 搜索
  // 例：「乘风第七季」→ 「乘风」,「开始推理吧 第四季」→ 「开始推理吧」
  // 例：「老友记 第一季（1994）」→ 「老友记」（不剥 year 不然搜不到 Friends 1994）
  // 2026-07-09: 新加常见后缀 token 剥除
  // 2026-07-09: 智能续集识别 - "真人快打2" 搜不到时, 降级搜 "真人快打" (TMDB 用系列名)
  raw = raw
    .replace(/第[一二三四五六七八九十\d]+季/g, '')
    .replace(/S\d{1,2}(?=[^\d]|$)/gi, '')
    .replace(/Season\s*\d{1,2}/gi, '')
    .replace(/[（(]\s*\d{4}\s*[)）]/g, '')
    .replace(/\s+(杜比视界|杜比音效|Dolby\s*Vision|Dolby\s*Atmos|IMAX\s*Enhanced|IMAX|4K\s*修复|导演剪辑版?|终极版|加长版|特别版|抢先版|正式版|国语配音|国配|港版|台版|美版|日版|韩版|欧版|东南亚版|英版|重制版|修复版|高码|高码率)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // A1: 片名.规格（排除片名.年份）
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

  // A2: PT格式 [中文名_英文名_年份] 或 [片名.年份]
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

  // B: 多段括号 [片名][规格]
  const multiBrackets = Array.from(raw.matchAll(/\[([^\]]+)\]/g));
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

  // C: 点分隔
  const dotParts = raw.split('.');
  for (const part of dotParts) {
    const p = part.trim();
    if (p.length >= 2 && /[\u4e00-\u9fff]/.test(p)) {
      if (!/^(19\d{2}|20\d{2}|4K|8K|蓝光原盘|蓝光remux|HDTV|WEBRip|BluRay|DIY)$/i.test(p)) {
        return { cleanName: p, year, season };
      }
    }
  }

  // D: 书名号
  const bookMatch = raw.match(/《([^》]+)》/);
  if (bookMatch) {
    const content = bookMatch[1].trim();
      if (content.length >= 2) {
        let t = content.replace(/\s*(19\d{2}|20\d{2})\s*/g, ' ').replace(/\s*(4K|蓝光原盘|蓝光|HDTV|WEBRip)\s*/gi, ' ').trim();
        if (t) return { cleanName: t, year, season };
      }
  }

  // E: 括号
  const parenMatch = raw.match(/[（(]([^）)]+)[)）]/);
  if (parenMatch) {
    const content = parenMatch[1].trim();
    if (content.length >= 2 && /[\u4e00-\u9fff]/.test(content)) {
      return { cleanName: content, year, season };
    }
  }

  // F: 最长中文片段
  const chineseFragments = raw.match(/[\u4e00-\u9fff][^\[\]（）【】《》\s]{0,30}/g);
  if (chineseFragments && chineseFragments.length > 0) {
    let best = '';
    for (const frag of chineseFragments) {
      if (frag.length > best.length && frag.length >= 2) best = frag.trim();
    }
    if (best) return { cleanName: best, year, season };
  }

  // G: 纯英文
  const trimmed = raw.replace(/^[\[\]（）【】《》\s]+|[\[\]（）【】《》\s]+$/g, '').trim();
  if (trimmed.length >= 2 && !/[\u4e00-\u9fff]/.test(trimmed)) {
    return { cleanName: trimmed, year, season };
  }

  // H: 去掉尾部 (年份) 后缀
  const afterStrip = raw.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  if (afterStrip.length >= 2 && /[\u4e00-\u9fff]/.test(afterStrip)) return { cleanName: afterStrip, year, season };

  // 兜底
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

// 状态黑名单
const BAD_STATUSES: Record<string, string[]> = {
  tv: ['In Production', 'Planned'],
  movie: ['In Production', 'Planned'],
};
const PREFER_STATUSES: Record<string, string[]> = {
  '连载': ['Returning Series'],
  'default': ['Ended', 'Canceled', 'Released'],
};
function isStatusOk(type: 'movie' | 'tv', status: string | undefined): boolean {
  if (!status) return true;
  return !(BAD_STATUSES[type] || []).includes(status);
}
function getPreferredStatuses(category: string, type: 'tv' | 'movie'): string[] {
  const pref = PREFER_STATUSES[category] || PREFER_STATUSES.default;
  if (type === 'movie') {
    return pref.filter(s => s === 'Released' || s === 'Canceled');
  }
  return pref;
}

// Levenshtein 编辑距离
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
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

function normStr(s: string) {
  return s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').trim();
}
function bigramSet(s: string) {
  const cs = Array.from(s);
  const pairs: string[] = [];
  for (let i = 0; i < cs.length - 1; i++) pairs.push(cs[i] + cs[i + 1]);
  if (cs.length === 1) pairs.push(cs[0]);
  return pairs;
}
function bigramSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const a0 = normStr(a), b0 = normStr(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  const sA = bigramSet(a0), sB = bigramSet(b0);
  let inter = 0;
  for (let i = 0; i < sA.length; i++) { if (sB.includes(sA[i])) inter++; }
  const u = sA.length + sB.length - inter;
  return u === 0 ? 0 : inter / u;
}

async function searchTmdb(name: string, type: 'tv' | 'movie', category: string, year?: string, lang = 'zh-CN', keyIndex = 0, useYear = false) {
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

    const candidates: Array<{ result: any; status: string | undefined }> = [];
    for (const r of data.results) {
      const status = r.status || (type === 'tv' ? r.status || 'Unknown' : r.release_date ? 'Released' : 'Unknown');
      if (!isStatusOk(type, status)) continue;
      candidates.push({ result: r, status });
      if (candidates.length >= 8) break;
    }
    if (candidates.length === 0) return null;

    if (candidates.length === 1 && useYear) {
      if (year) {
        const releaseYear = (candidates[0].result.release_date || candidates[0].result.first_air_date || '').slice(0, 4);
        if (releaseYear && Math.abs(parseInt(releaseYear) - parseInt(year)) > 2) {
          return null;
        }
      }
      return { ...candidates[0].result, genres: candidates[0].result.genre_ids ? [] : (candidates[0].result.genres || []), tmdb_status: candidates[0].status };
    }

    let filtered = candidates;
    if (year) {
      filtered = candidates.filter(c => {
        const ry = (c.result.release_date || c.result.first_air_date || '').slice(0, 4);
        return !ry || Math.abs(parseInt(ry) - parseInt(year)) <= 2;
      });
      if (filtered.length === 0) filtered = candidates;
      if (filtered.length === 1) {
        return { ...filtered[0].result, genres: filtered[0].result.genre_ids ? [] : (filtered[0].result.genres || []), tmdb_status: filtered[0].status };
      }
    }

    const norm = (s: string) => s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
    const cn = norm(name);
    // 1:1
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.length === cn.length && tn === cn) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // sub-string
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.includes(cn) && cn.length >= 2 && tn.length - cn.length <= 6) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // prefix
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.startsWith(cn) && cn.length >= 2) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // bigram
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (bigramSim(cn, tn) >= 0.6) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // Levenshtein
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
          return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
        }
      }
    }
    if (!useYear) return null;
    return { ...filtered[0].result, genres: filtered[0].result.genre_ids ? [] : (filtered[0].result.genres || []), tmdb_status: filtered[0].status };
  } catch { return null; }
}

function subTypeToTmdb(subType: string | null): 'movie' | 'tv' {
  if (!subType) return 'movie';
  const s = subType.toLowerCase();
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}
function subTypeToTmdbWithExtension(subType: string | null): 'movie' | 'tv' {
  if (!subType) return 'movie';
  const s = subType.toLowerCase();
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}

// 核心匹配函数 (单条)
export async function matchOne(rawName: string, category: string, subType: string | null): Promise<{ id: string; tmdb_type: 'movie' | 'tv'; poster: string; title: string; vote: number; year: string } | 'GARBLED' | 'NOMATCH'> {
  if (isGarbled(rawName)) return 'GARBLED';

  // {tmdb-XXXXX} 占位符
  const tmdbMatch = rawName.match(/\{tmdb-(\d+)\}/);
  if (tmdbMatch) {
    const tmdbId = tmdbMatch[1];
    let tmdbType: 'movie' | 'tv' = 'movie';
    if (['剧集', '动漫', '综艺', '少儿频道'].includes(category)) tmdbType = 'tv';
    return {
      id: tmdbId,
      tmdb_type: tmdbType,
      poster: '',
      title: rawName.replace(/\s*\{tmdb-\d+\}/, '').trim(),
      vote: 0,
      year: '',
    };
  }

  const isFileNameString = /\[[^\]]+\]|\.iso|1080p|720p|2160p|480p|4K|8K|UHD|BDMV|Blu-?ray|REMUX|HDTV|WEB-?DL|HEVC|AVC|x\.?264|x\.?265|HDR10|Dolby|TrueHD|Atmos|DTS/i.test(rawName)
    || /[（(]\d{4}[)）]/.test(rawName)
    || /第[一二三四五六七八九十\d]+季|S\d{1,2}/i.test(rawName);

  let cleanName: string, year: string, season: number | null;
  if (isFileNameString) {
    const r = cleanFolderName(rawName);
    cleanName = r.cleanName; year = r.year; season = r.season;
  } else {
    cleanName = rawName
      .replace(/\s*[（(]\s*\d{4}\s*[)）]\s*$/g, '')
      .replace(/第[一二三四五六七八九十\d]+季.*$/g, '')
      .replace(/\s*\{tmdb-\d+\}/g, '')
      .trim();
    const ym = cleanName.match(/[（(]\s*(19\d{2}|20\d{2})\s*[)）]/);
    year = ym ? ym[1] : '';
    if (year && ym) cleanName = cleanName.replace(ym[0], '').trim();
    const sm = cleanName.match(/第([一二三四五六七八九十\d]+)季|S(\d{1,2})/i);
    season = sm ? (sm[1] ? chineseToNumber(sm[1]) : parseInt(sm[2])) : null;
    if (sm) cleanName = cleanName.replace(sm[0], '').trim();
  }

  if (!cleanName || cleanName.length < 2) return 'NOMATCH';
  if (cleanName.length > 80) cleanName = cleanName.slice(0, 80);

  const isEng = isEnglishName(cleanName);

  const strategies = isEng
    ? [
        { lang: 'en-US', useYear: true },
        { lang: 'en-US', useYear: false },
        { lang: 'zh-CN', useYear: true },
      ]
    : [
        { lang: 'zh-CN', useYear: true },
        { lang: 'zh-CN', useYear: false },
        { lang: 'en-US', useYear: true },
      ];

    let typeOrder: ('tv' | 'movie')[];
    if (category === '演唱会') {
      typeOrder = ['movie', 'tv'];
    } else if (category === '纪录片') {
      typeOrder = ['tv', 'movie'];
    } else if (subType) {
      const tmdbType = subTypeToTmdbWithExtension(subType);
      typeOrder = [tmdbType, tmdbType === 'movie' ? 'tv' : 'movie'];
    } else if (['连载', '剧集', '动漫', '综艺', '少儿频道'].includes(category)) {
      typeOrder = ['tv'];
    } else if (['电影', '华语电影', '外语电影', '动画电影', 'REMUX', '系列电影'].includes(category)) {
      typeOrder = ['movie', 'tv'];
    } else if (season !== null) {
      typeOrder = ['tv'];
    } else {
      typeOrder = ['movie', 'tv'];
    }

    let keyIdx = 0;
    for (const s of strategies) {
      for (const type of typeOrder) {
        const result = await searchTmdb(cleanName, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length, s.useYear);
        keyIdx++;
        if (result) {
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
    }

    // 续集降级
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
              id: String(result.id),
              tmdb_type: type,
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
