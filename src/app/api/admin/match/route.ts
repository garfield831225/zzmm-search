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

function cleanFolderName(folderName: string): { cleanName: string; year: string; season: number | null } {
  const yearMatch = folderName.match(/[.\s](20\d{2})[.\s]/);
  const extractedYear = yearMatch ? yearMatch[1] : '';

  const seasonPatterns = [
    /第([一二三四五六七八九十\d]+)季/i,
    /Season\s*(\d+)/i,
    /S(\d{1,2})E\d+/i,
  ];
  let season: number | null = null;
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
    /2160p|1080p|720p|480p/gi,
    /WEB-DL|BluRay|BDRip|HDTV|WEBRip|REMUX|Blu-ray|BDMV/gi,
    /H265|H264|HEVC|AVC|x264|x265/gi,
    /杜比视界|杜比全景声|DV|HDR10\+|HDR10|HDR|ATMOS|DDP5\.1|DDP|DTS-HD|DTS|AAC5\.1|AAC|TrueHD|EAC3/gi,
    /国语中字|中英双字|中英字幕|双语字幕|外挂字幕|国语配音|中文字幕|中字|字幕|粤语|台配|配音/gi,
    /导演剪辑版|导演剪辑|加长版|完整版|未删减版|剧场版|REMUX/gi,
    /IMAX|SDR|AC3/gi,
    /蓝光原盘|蓝光|蓝光remux|HD|内嵌|封包|封装/gi,
    /DIY|次时代|官译|特效字幕|双语|简繁|繁简/gi,
    /CEE|美版|日版|港版|韩版|欧版|台版/gi,
    /Athena@|CHDBits@|HDSky@|HDHome@|ltzww@/gi,
  ];
  for (const pat of noisePatterns) {
    cleanName = cleanName.replace(pat, ' ');
  }

  cleanName = cleanName.replace(/[.\s]?\d{4}.*$/g, '');
  cleanName = cleanName.replace(/\.(mkv|mp4|avi|ts|m2ts|wmv|flv)$/gi, '');
  cleanName = cleanName.replace(/\./g, ' ').replace(/\?/g, '').replace(/\s+/g, ' ').trim();

  return { cleanName, year: extractedYear, season };
}

// 搜索单个片名
async function searchTmdb(name: string, type: 'tv' | 'movie', year?: string, lang = 'zh-CN', keyIndex = 0) {
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
    return data.results[0];
  } catch { return null; }
}

// 核心匹配函数（精简策略，3次尝试上限）
async function matchOne(rawName: string): Promise<{ id: string; poster: string; title: string; vote: number; year: string } | 'GARBLED' | 'NOMATCH'> {
  if (isGarbled(rawName)) return 'GARBLED';

  const { cleanName, year, season } = cleanFolderName(rawName);
  if (cleanName.length < 2) return 'NOMATCH';

  const isEng = isEnglishName(cleanName);

  // 精简策略：最多3次
  // 1. 最可能成功的策略（有年份+合适语言）
  // 2. 同一语言无年份
  // 3. 跨语言有年份（最终兜底）
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

  const typeOrder: ('tv' | 'movie')[] = season !== null ? ['tv'] : ['tv', 'movie'];

    let keyIdx = 0;
    for (const s of strategies) {
      for (const type of typeOrder) {
        const result = await searchTmdb(cleanName, type, s.useYear ? year : undefined, s.lang, keyIdx % TMDB_KEYS.length);
        keyIdx++;
        if (result) {
          return {
            id: String(result.id),
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
async function cacheIt(r: { id: string; poster: string; title: string; vote: number; year: string }, sqlFn: any) {
  try {
    await sqlFn`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)
      VALUES (${r.id}, ${'movie'}, ${r.title}, ${''}, ${''}, ${r.poster}, ${r.vote}, ${0}, ${r.year || null}, ${null}, ${''}, ${''}, NOW())
      ON CONFLICT (tmdb_id) DO UPDATE SET title = EXCLUDED.title, poster_path = EXCLUDED.poster_path, vote_average = EXCLUDED.vote_average, cached_at = NOW()
    `;
  } catch {}
}

// ─── 主入口 ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');
  if (key !== '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606') {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  const batchSize = Math.min(1000, Math.max(50, parseInt(searchParams.get('batchSize') || '500')));

  try {
    const rows = await sql`
      SELECT id, name, link, category, source
      FROM xx_resources
      WHERE tmdb_id IS NULL
        AND status = 'active'
        AND name IS NOT NULL
        AND LENGTH(name) > 2
        AND category NOT IN ('学习资料', '音乐', '纪录片', '其他', '演唱会', '体育赛事', '少儿频道', '合集')
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
          const result = await matchOne(item.name);
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
