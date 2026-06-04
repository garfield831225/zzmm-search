import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const TMDB_KEYS = [
  '7985342d5961e9ee3d5ef6d969c1b8dd',
  '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

// ─── 速率限制器（双 key 各 50 req/sec，共 100 req/sec）──────────
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

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

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
function isGarbled(name: string): boolean {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i)!;
    // 替换字符（U+FFFD）→ 解码失败乱码
    if (cp === 0xfffd) { garbageLen++; continue; }
    // 问号（U+003F）在片名中极少出现 → 乱码特征
    if (cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = (cp >= 0x3000 && cp <= 0x303f) || (cp >= 0xff00 && cp <= 0xffef) || [0x2e, 0xff0e, 0x3001, 0x3002, 0xff01, 0xff1f, 0x2018, 0x2019, 0xff08, 0xff09, 0x300a, 0x300b, 0x3008, 0x3009, 0x3010, 0x3011, 0x201c, 0x201d, 0xff5b, 0xff5d, 0x5b, 0x5d, 0x28, 0x29, 0x2d, 0x2e].includes(cp);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}

// 重写版 cleanFolderName (多策略提取)
function cleanFolderName(raw: string): { cleanName: string; year: string; season: number | null } {
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
      extracted = extracted.replace(/^(4K|8K|2160p|1080p|720p|DIY|CEE|美版|日版|港版|欧版|韩版|台版|DV|HDR|Dolby|Atmos|DTS|HEVC|LPCM)\s*/i, '');
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
  raw = raw
    .replace(/第[一二三四五六七八九十\d]+季/g, '')
    .replace(/S\d{1,2}(?=[^\d]|$)/gi, '')
    .replace(/Season\s*\d{1,2}/gi, '')
    .replace(/[（(]\s*\d{4}\s*[)）]/g, '')
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
  // 2026-06-03 兜底再剥一次「第X季」（防止前面策略未覆盖到）
  t = t.replace(/第[一二三四五六七八九十\d]+季/g, '').replace(/\s+/g, ' ').trim();
  return { cleanName: t, year, season };
}

// 搜索单个片名
// TMDB status 黑名单：拒绝未开播内容（In Production 制作中、Planned 计划中）
const BAD_STATUSES: Record<string, string[]> = {
  tv: ['In Production', 'Planned'],
  movie: ['In Production', 'Planned'],
};
// 按 category 决定优先匹配的状态
const PREFER_STATUSES: Record<string, string[]> = {
  '连载': ['Returning Series'],  // 连载分类：优先匹配追更中的
  'default': ['Ended', 'Canceled', 'Released'],  // 其他分类：优先匹配已播完/已上映
};
function isStatusOk(type: 'movie' | 'tv', status: string | undefined): boolean {
  if (!status) return true;
  return !(BAD_STATUSES[type] || []).includes(status);
}
function getPreferredStatuses(category: string, type: 'tv' | 'movie'): string[] {
  const pref = PREFER_STATUSES[category] || PREFER_STATUSES.default;
  // 电影没有 Returning Series 概念（电影只区分 Released/In Production/Planned）
  if (type === 'movie') {
    return pref.filter(s => s === 'Released' || s === 'Canceled');
  }
  return pref;
}
function isPreferred(category: string, type: 'tv' | 'movie', status: string | undefined): boolean {
  if (!status) return false;
  return getPreferredStatuses(category, type).includes(status);
}

async function searchTmdb(name: string, type: 'tv' | 'movie', category: string, year?: string, lang = 'zh-CN', keyIndex = 0) {
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

    // 先收集所有候选的 status
    const candidates: Array<{ result: any; status: string | undefined }> = [];
    for (const r of data.results) {
      const detail = await getTmdbDetails(String(r.id), type, keyIndex);
      if (!detail) continue;
      if (!isStatusOk(type, detail.status)) continue;  // 黑名单直接跳
      candidates.push({ result: r, status: detail.status });
      if (candidates.length >= 8) break;  // 限制每个搜索最多 8 个候选，避免过多 detail 调用
    }
    if (candidates.length === 0) return null;

    // 2026-06-03 修：必须 1:1 严格匹配（length 相等 + norm 完全相等）才返回
    // 修复「情书」被错配到「给阿嫲的情书」（子串命中但长度差 3 倍）
    const norm = (s: string) => s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '');
    const cn = norm(name);
    // 第一优先：按 category 偏好状态 + 1:1 匹配
    for (const c of candidates) {
      if (!isPreferred(category, type, c.status)) continue;
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.length !== cn.length) continue;  // 长度必须相等
      if (tn === cn) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    // 第二优先：其他允许的状态 + 1:1 匹配
    for (const c of candidates) {
      const t = c.result.title || c.result.name || '';
      if (!t) continue;
      const tn = norm(t);
      if (tn.length !== cn.length) continue;
      if (tn === cn) {
        return { ...c.result, genres: c.result.genre_ids ? [] : (c.result.genres || []), tmdb_status: c.status };
      }
    }
    return null;
  } catch { return null; }
}

// sub_type → tmdb 类型
function subTypeToTmdb(subType: string | null): 'movie' | 'tv' {
  if (!subType) return 'movie';
  const s = subType.toLowerCase();
  // 剧集类 → tv
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧'].some(t => s.includes(t))) return 'tv';
  // 其他（电影/演唱会/3D原盘/动画电影等）→ movie
  return 'movie';
}

// 核心匹配函数（精简策略，3次尝试上限）
async function matchOne(rawName: string, category: string, subType: string | null): Promise<{ id: string; tmdb_type: 'movie' | 'tv'; poster: string; title: string; vote: number; year: string } | 'GARBLED' | 'NOMATCH'> {
  if (isGarbled(rawName)) return 'GARBLED';

  const { cleanName, year, season } = cleanFolderName(rawName);
  if (cleanName.length < 2) return 'NOMATCH';

  const isEng = isEnglishName(cleanName);

  // 精简策略：最多3次
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

    // 强制按类别决定 TMDB 搜索类型（关键！剧集不能匹配 movie，电影不能匹配 tv）
    let typeOrder: ('tv' | 'movie')[];
    if (category === '演唱会') {
      typeOrder = ['movie'];
    } else if (category === '纪录片') {
      typeOrder = ['tv', 'movie'];
    } else if (subType) {
      // 有 sub_type → 直接按 sub_type 查对应类型
      const tmdbType = subTypeToTmdb(subType);
      typeOrder = [tmdbType];
    } else if (['连载', '剧集', '动漫', '综艺', '少儿频道'].includes(category)) {
      // 剧集类只搜 tv
      typeOrder = ['tv'];
    } else if (['电影', '华语电影', '外语电影', '动画电影', 'REMUX', '系列电影'].includes(category)) {
      // 电影类只搜 movie
      typeOrder = ['movie'];
    } else if (season !== null) {
      typeOrder = ['tv'];
    } else {
      typeOrder = ['movie'];
    }

    let keyIdx = 0;
    for (const s of strategies) {
      for (const type of typeOrder) {
        const result = await searchTmdb(cleanName, type, category, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length);
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
  return 'NOMATCH';
}

// 缓存到 xx_tmdb_cache
async function getTmdbDetails(tmdbId: string, type: 'movie' | 'tv', keyIndex = 0) {
  await tmdbLimiter.wait(keyIndex);
  const url = `${TMDB_BASE}/${type}/${tmdbId}?api_key=${TMDB_KEYS[keyIndex % TMDB_KEYS.length]}&language=zh-CN`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function getTmdbCredits(tmdbId: string, type: 'movie' | 'tv', keyIndex = 0) {
  await tmdbLimiter.wait(keyIndex);
  const url = `${TMDB_BASE}/${type}/${tmdbId}/credits?api_key=${TMDB_KEYS[keyIndex % TMDB_KEYS.length]}&language=zh-CN`;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function cacheIt(r: { id: string; tmdb_type: 'movie' | 'tv'; poster: string; title: string; vote: number; year: string; overview?: string; tagline?: string; genres?: string[]; vote_count?: number; original_title?: string }, sqlFn: any) {
  try {
    await sqlFn`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)
      VALUES (
        ${r.id}, ${r.tmdb_type}, ${r.title},
        ${r.original_title || null},
        ${r.overview || null},
        ${r.poster},
        ${r.vote}, ${r.vote_count || 0},
        ${r.year || null}, ${null},
        ${r.tagline || null},
        ${r.genres ? JSON.stringify(r.genres) : null},
        NOW()
      )
      ON CONFLICT (tmdb_id) DO UPDATE SET
        title = EXCLUDED.title,
        poster_path = EXCLUDED.poster_path,
        vote_average = EXCLUDED.vote_average,
        vote_count = EXCLUDED.vote_count,
        release_date = COALESCE(EXCLUDED.release_date, xx_tmdb_cache.release_date),
        overview = COALESCE(EXCLUDED.overview, xx_tmdb_cache.overview),
        tagline = COALESCE(EXCLUDED.tagline, xx_tmdb_cache.tagline),
        genres = COALESCE(EXCLUDED.genres, xx_tmdb_cache.genres),
        original_title = COALESCE(EXCLUDED.original_title, xx_tmdb_cache.original_title),
        cached_at = NOW()
    `;
  } catch {}
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (key !== (process.env.JWT_SECRET || 'cLWhs2015')) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  const batchSize = Math.min(1000, Math.max(50, parseInt(searchParams.get('batchSize') || '500')));

  try {
    const rows = await sql`
      SELECT id, name, link, category, source, sub_type
      FROM xx_resources
      WHERE tmdb_id IS NULL
        AND status = 'active'
        AND name IS NOT NULL
        AND LENGTH(name) > 2
        AND category NOT IN ('音乐', '体育', '合集', '学习资料', '其他', '游戏', '电子书', '精品课', '文档')
      ORDER BY id
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    ` as any[];

    if (!rows.length) {
      return NextResponse.json({ done: true, processed: 0, matched: 0 });
    }

    // 批量查询：这些 link 是否已被其他记录匹配过
    const links = rows.map(r => r.link).filter(Boolean);
    let linkMap: Record<string, string> = {};
    if (links.length > 0) {
      const existing = await sql`
        SELECT link, tmdb_id
        FROM xx_resources
        WHERE link = ANY(${links})
          AND tmdb_id IS NOT NULL
          AND tmdb_id != ''
          AND tmdb_id NOT IN ('GARBLED', 'NOMATCH')
      ` as any[];
      for (const r of existing) {
        if (r.link && r.tmdb_id) linkMap[r.link] = r.tmdb_id;
      }
    }

    // 20 并发，速率限制 50ms
    const CONCURRENCY = 20;
    const results: { id: number; tmdb_id: string | null; reused?: boolean }[] = [];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          // 链接去重：同链接已被匹配过，直接复用
          if (item.link && linkMap[item.link]) {
            const reusedId = linkMap[item.link];
            await sql`UPDATE xx_resources SET tmdb_id = ${reusedId}, updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            return { id: item.id, tmdb_id: reusedId, reused: true };
          }
          const result = await matchOne(item.name, item.category, item.sub_type || null);
          if (result === 'GARBLED') {
            const r = await sql`UPDATE xx_resources SET tmdb_id = 'GARBLED', updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            return { id: item.id, tmdb_id: r.length ? 'GARBLED' : null, updateFailed: !r.length };
          }
          if (result === 'NOMATCH') {
            const r = await sql`UPDATE xx_resources SET tmdb_id = 'NOMATCH', updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            return { id: item.id, tmdb_id: r.length ? 'NOMATCH' : null, updateFailed: !r.length };
          }
          if (result) {
            const updResult = await sql`UPDATE xx_resources SET tmdb_id = ${result.id}, updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            if (!updResult.length) {
              // UPDATE failed - record not found or already updated
              return { id: item.id, tmdb_id: null, updateFailed: true };
            }
            await cacheIt(result, sql);
            return { id: item.id, tmdb_id: result.id };
          }
          return { id: item.id, tmdb_id: null };
        })
      );
      results.push(...chunkResults);
      // 每 chunk 间隔 100ms，防止并发过大
      if (i + CONCURRENCY < rows.length) await new Promise(r => setTimeout(r, 100));
    }

    const matched = results.filter(r => r.tmdb_id && r.tmdb_id !== 'GARBLED' && r.tmdb_id !== 'NOMATCH' && !(r as any).updateFailed).length;
    const updateFailed = results.filter(r => (r as any).updateFailed).length;
    const garbledMarked = results.filter(r => r.tmdb_id === 'GARBLED').length;
    const nomatchMarked = results.filter(r => r.tmdb_id === 'NOMATCH').length;
    const reused = results.filter(r => r.reused).length;
    return NextResponse.json({
      processed: rows.length,
      matched,
      nomatch: nomatchMarked,
      garbled: garbledMarked,
      reused,
      updateFailed,
      sample: rows.slice(0, 3).map(r => r.name.slice(0, 40)),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 300) }, { status: 500 });
  }
}
