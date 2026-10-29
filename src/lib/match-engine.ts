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
const TMDB_IMG = 'https://image.zzmm-search.uk/t/p/w500';

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

// 2026-10-29: 片名提取已重写到 lib/clean-title.ts (用 8864 条真实样本实测定位的 7 个缺陷)
//   旧版问题: F 分支被画质/字幕词劫持 / WEB-4K 残留 / HDR10 留 10 / 集数标记没剥
//   / 发布组前缀没剥 / 双语片名没拆 / 短剧前缀+演员名没剥
//   新的返回 { cleanName, year, season, alts } —— alts 是备选片名, 匹配层依次尝试
import { cleanFolderName } from './clean-title';
export { cleanFolderName };
export type { CleanResult } from './clean-title';

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
    // 2026-10-29: tier 顺序改成 exact → prefix → sub (prefix 比 sub 精确)
    //   原因: 「龙之家族 第三季」用 sub 会匹配到《龙之家族：幕后特辑》(特辑不是正片)
    //   prefix 不成立 → 落到 sub 时若候选是「龙之家族」本身则差值大 → 不匹配 ✅
    // prefix
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.startsWith(cn) && cn.length >= 2) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // sub-string (⚠️ 短名 <3 字禁用 —— "火花" 会匹配到《幽灵火花》这种同类型不同作品)
    if (cn.length >= 3) {
      for (const c of filtered) {
        const t = c.result.title || c.result.name || '';
        if (!t) continue;
        const tn = norm(t);
        if (tn.includes(cn) && tn.length - cn.length <= 6) {
          return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
        }
      }
    }
    // bigram
    for (const c of filtered) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (bigramSim(cn, tn) >= 0.5) {  // 2026-08-14: 0.6 → 0.5 (用户拍板, 更宽松, 多匹配些)
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
        const allow = Math.max(2, Math.floor(maxLen * 0.4));  // 2026-08-14: 0.3 → 0.4 (更宽松)
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
  // 2026-10-29: 加「短剧」—— 短剧 84425 条原来按 movie 搜, TMDB 里短剧都在 tv → 匹配率只有 1.7%
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载', '短剧', '微短剧'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}

// 2026-10-29: 不该用 TMDB 匹配的分类 (各有专属数据源)
//   软件→无 / 音乐→MusicBrainz / 电子书·文档·精品课·学习资料→文档库 / 游戏→无 / 体育→Football API / 合集→多资源集合
//   实测这些分类合计 46908 条, 其中大量是 null_tmdb (从没匹配过) → 跳过能省十几万次 TMDB 调用
//   并且避免给"短剧合集""课程"之类硬匹配出错的封面
export const SKIP_MATCH_CATEGORIES = new Set([
  '软件', '音乐', '电子书', '文档', '精品课', '学习资料', '有声书',
  '游戏', 'PC游戏', 'Swtich游戏', '体育', '导航首页', '合集',
]);

// 2026-10-29: 明确按 tv 搜的分类 (短剧漏了 → 1.7% 匹配率)
//   ⚠️ 直接复用 categories.ts 的真相源, 跟前端"这条资源能不能显示 TMDB 海报"的判定保持一致
//   两边各写一份 → 匹配写进去的 tmdb_type 跟前端期望对不上 → 匹配上了但没封面
import { TMDB_TV_CATS, TMDB_MOVIE_CATS } from './categories';
export const TV_ONLY_CATEGORIES = TMDB_TV_CATS;
export const MOVIE_ONLY_CATEGORIES = TMDB_MOVIE_CATS;

/**
 * 分类 → TMDB 类型候选 (cron 和 admin 共用, 避免两套实现跑偏)
 */
export function getTypesForCategory(category: string, subType: string | null, season: number | null): ('tv' | 'movie')[] | null {
  if (SKIP_MATCH_CATEGORIES.has(category)) return null;
  if (season !== null) return ['tv'];
  if (TV_ONLY_CATEGORIES.has(category)) return ['tv'];
  if (category === '演唱会') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(subType || '')) return ['movie'];
    return ['tv'];
  }
  if (MOVIE_ONLY_CATEGORIES.has(category)) return ['movie'];
  if (subType) {
    const t = subTypeToTmdbWithExtension(subType);
    return [t];
  }
  return null;
}

// 核心匹配函数 (单条)
// 2026-10-29: 返回类型加 'SKIP' (不该用 TMDB 匹配的分类: 软件/音乐/电子书/文档/游戏/体育...)
export async function matchOne(rawName: string, category: string, subType: string | null): Promise<{ id: string; tmdb_type: 'movie' | 'tv'; poster: string; title: string; vote: number; year: string } | 'GARBLED' | 'NOMATCH' | 'SKIP'> {
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

  // 2026-10-29: 统一走 clean-title 的新提取器 (多策略 + 多候选)
  //   旧版只对"像文件名"的字符串走清洗, 其它走简易 replace → 很多脏名字没被清洗
  const cleaned = cleanFolderName(rawName);
  let cleanName = cleaned.cleanName;
  let year = cleaned.year;
  let season = cleaned.season;
  const altNames: string[] = cleaned.alts || [];

  if (!cleanName || cleanName.length < 2) return 'NOMATCH';
  if (cleanName.length > 80) cleanName = cleanName.slice(0, 80);

  // 2026-10-29: 不该用 TMDB 匹配的分类直接跳过 (省配额, 避免错匹配)
  if (SKIP_MATCH_CATEGORIES.has(category)) return 'SKIP';

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
    // 2026-08-14: season 优先级提到最前 - 检到 "第X季" 就先试 tv (短剧/剧集都标了"电影"category, 实际是 tv)
    if (season !== null) {
      typeOrder = ['tv', 'movie'];
    } else if (category === '演唱会') {
      typeOrder = ['movie', 'tv'];
    } else if (category === '纪录片') {
      typeOrder = ['tv', 'movie'];
    } else if (subType) {
      const tmdbType = subTypeToTmdbWithExtension(subType);
      typeOrder = [tmdbType, tmdbType === 'movie' ? 'tv' : 'movie'];
    } else if (TV_ONLY_CATEGORIES.has(category)) {
      typeOrder = ['tv'];
    } else if (MOVIE_ONLY_CATEGORIES.has(category)) {
      typeOrder = ['movie', 'tv'];
    } else {
      typeOrder = ['movie', 'tv'];
    }

    // 2026-10-29: 多候选片名依次尝试
    //   旧版只试 1 个片名 → 片名提取错一点就彻底匹配不上
    //   新版: 主名 + 备选名 (clean-title 返回的 alts, 如双语片名的另一段/次长中文片段)
    //   预算上限 16 次 TMDB 调用/条 (admin 单条/小批量手动匹配用; 批量走 cron 的评分版, 预算更小)
    const MAX_CALLS = 16;
    const names: string[] = [];
    for (const n of [cleanName, ...altNames]) {
      if (!n || n.length < 2) continue;
      if (names.includes(n)) continue;
      names.push(n);
    }
    const nameList = names.slice(0, 4);

    let keyIdx = 0;
    const mkResult = (result: any, type: 'tv' | 'movie') => ({
      id: String(result.id),
      tmdb_type: type,
      poster: result.poster_path ? `${TMDB_IMG}${result.poster_path}` : '',
      title: result.title || result.name || cleanName,
      vote: result.vote_average || 0,
      year: (result.release_date || result.first_air_date || '').slice(0, 4) || year,
    });

    for (const nm of nameList) {
      for (const s of strategies) {
        for (const type of typeOrder) {
          if (keyIdx >= MAX_CALLS) break;
          const result = await searchTmdb(nm, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length, s.useYear);
          keyIdx++;
          if (result) return mkResult(result, type);
        }
      }
      // 续集降级 (真人快打2 → 真人快打)
      let noTrailingNum = nm;
      for (let i = 0; i < 3; i++) {
        const next = noTrailingNum.replace(/[\s:：\-_+/&]?\d{1,3}\s*$/, '').trim();
        if (next === noTrailingNum) break;
        noTrailingNum = next;
      }
      if (noTrailingNum !== nm && noTrailingNum.length >= 2) {
        for (const s of strategies) {
          if (keyIdx >= MAX_CALLS) break;
          for (const type of typeOrder) {
            if (keyIdx >= MAX_CALLS) break;
            const result = await searchTmdb(noTrailingNum, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length, s.useYear);
            keyIdx++;
            if (result) return mkResult(result, type);
          }
        }
      }
    }
  return 'NOMATCH';
}
