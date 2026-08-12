// 2026-08-12: 抽 lib 后, 核心匹配逻辑 (cleanFolderName / searchTmdb / matchOne) 在 lib/match-engine.ts
//   保留: getTmdbDetails + getTmdbCredits + cacheIt (cache 到 xx_tmdb_cache, admin match 专属)
//   公开 /api/match-single + /api/match-batch 走 lib 的 matchOne, 不写 cache (调用方自己决定)
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { matchOne, isGarbled, cleanFolderName } from '@/lib/match-engine';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // Vercel hobby 60s, 客户端分批调

const TMDB_KEYS = [
  '7985342d5961e9ee3d5ef6d969c1b8dd',
  '79e41efe870e60afb09b9de8baa47cf1',
];
const TMDB_BASE = 'https://api.themoviedb.org/3';

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
  let detail: any = null;
  try { detail = await getTmdbDetails(r.id, r.tmdb_type); } catch {}
  const originalTitle = detail?.original_title || detail?.original_name || r.original_title || null;
  const overview = detail?.overview || r.overview || null;
  const tagline = detail?.tagline || r.tagline || null;
  const genres = (detail?.genres || []).map((g: any) => g.name);
  const backdrop = detail?.backdrop_path || null;
  const releaseDate = detail?.release_date || detail?.first_air_date || r.year || null;
  const voteCount = detail?.vote_count ?? r.vote_count ?? 0;
  const originCountry = r.tmdb_type === 'tv'
    ? (detail?.origin_country || []).join(',') || null
    : (detail?.production_countries?.[0]?.iso_3166_1 || null);
  try {
    await sqlFn`
      INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, backdrop_path, vote_average, vote_count, release_date, status, tagline, genres, origin_country, cached_at)
      VALUES (
        ${r.id}, ${r.tmdb_type}, ${r.title},
        ${originalTitle},
        ${overview},
        ${r.poster},
        ${backdrop},
        ${r.vote}, ${String(voteCount)},
        ${releaseDate}, ${detail?.status || null},
        ${tagline},
        ${genres.length ? genres : null},
        ${originCountry},
        NOW()
      )
      ON CONFLICT (tmdb_id) DO UPDATE SET
        title = EXCLUDED.title,
        original_title = COALESCE(EXCLUDED.original_title, xx_tmdb_cache.original_title),
        overview = COALESCE(EXCLUDED.overview, xx_tmdb_cache.overview),
        poster_path = EXCLUDED.poster_path,
        backdrop_path = COALESCE(EXCLUDED.backdrop_path, xx_tmdb_cache.backdrop_path),
        vote_average = EXCLUDED.vote_average,
        vote_count = COALESCE(EXCLUDED.vote_count, xx_tmdb_cache.vote_count),
        release_date = COALESCE(EXCLUDED.release_date, xx_tmdb_cache.release_date),
        status = COALESCE(EXCLUDED.status, xx_tmdb_cache.status),
        tagline = COALESCE(EXCLUDED.tagline, xx_tmdb_cache.tagline),
        genres = COALESCE(EXCLUDED.genres, xx_tmdb_cache.genres),
        origin_country = COALESCE(EXCLUDED.origin_country, xx_tmdb_cache.origin_country),
        cached_at = NOW()
    `;
  } catch {}
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const key = searchParams.get('key');

  const sql = neon(process.env.DATABASE_URL || '');
  const batchSize = Math.min(1000, Math.max(50, parseInt(searchParams.get('batchSize') || '500')));
  const fromId = parseInt(searchParams.get('fromId') || '0');
  const recoverMode = searchParams.get('recover') === '1';
  console.log('[match GET]', { batchSize, fromId, recoverMode });

  try {
    if (recoverMode) {
      const recovery = await sql`
        WITH base AS (
          SELECT
            r.id,
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(r.name, '\\(20[0-9]{2}\\)', ''),
                    '\\{tmdb-\\d+\\}', '', 'g'),
                  '第[一二三四五六七八九十\\d]+季', '', 'g'),
                'S\\d{1,2}|Season\\s*\\d{1,2}', '', 'g'),
              '\\[[^\\]]*\\]', '', 'g') AS core
          FROM xx_resources r
          WHERE r.status = 'active' AND r.tmdb_id = 'NOMATCH'
          LIMIT ${batchSize}
        ),
        normed AS (
          SELECT id, LOWER(regexp_replace(core, '[^[:alnum:][:space:]]', '', 'g')) AS core_norm
          FROM base
        ),
        candidates AS (
          SELECT DISTINCT ON (n.id)
            n.id, c.tmdb_id
          FROM normed n
          JOIN xx_tmdb_cache c
            ON LENGTH(c.title) >= 3
           AND (
             LOWER(regexp_replace(c.title, '[^[:alnum:][:space:]]', '', 'g')) = n.core_norm
             OR SUBSTRING(n.core_norm, 1, 30) LIKE
                '%' || LOWER(regexp_replace(c.title, '[^[:alnum:][:space:]]', '', 'g')) || '%'
           )
        )
        UPDATE xx_resources r
        SET tmdb_id = c.tmdb_id
        FROM candidates c
        WHERE r.id = c.id
        RETURNING r.id
      `;
      return NextResponse.json({
        done: true, recover: true,
        recovered: recovery.length,
        batchSize,
      });
    }

    const rows = await sql`
      SELECT id, name, link, category, source, sub_type, created_at
      FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active'
        AND name IS NOT NULL
        AND LENGTH(TRIM(name)) > 1
        AND category NOT IN ('音乐', '体育', '合集', '学习资料', '其他', '游戏', '电子书', '精品课', '文档')
        AND id > ${fromId}
        AND (last_attempt_at IS NULL OR last_attempt_at < NOW() - INTERVAL '5 minutes')
      ORDER BY
        CASE WHEN tmdb_id IN ('NOMATCH', 'GARBLED') THEN 1 ELSE 0 END,
        CASE
          WHEN category IN ('电影', '剧集', '动漫', '纪录片') THEN 0
          WHEN category IN ('演唱会', '连载') THEN 1
          ELSE 2
        END,
        created_at DESC,
        id
      LIMIT ${batchSize}
    ` as any[];

    if (!rows.length) {
      return NextResponse.json({ done: true, processed: 0, matched: 0 });
    }

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

    const CONCURRENCY = 20;
    const results: { id: number; tmdb_id: string | null; reused?: boolean }[] = [];

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (item) => {
          if (item.link && linkMap[item.link]) {
            const reusedId = linkMap[item.link];
            await sql`UPDATE xx_resources SET tmdb_id = ${reusedId}, matched_tmdb_at = NOW(), last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id}`.catch(() => {});
            return { id: item.id, tmdb_id: reusedId, reused: true };
          }
          const result = await matchOne(item.name, item.category, item.sub_type || null);
          if (result === 'GARBLED') {
            const r = await sql`UPDATE xx_resources SET tmdb_id = 'GARBLED', last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            return { id: item.id, tmdb_id: r.length ? 'GARBLED' : null, updateFailed: !r.length };
          }
          if (result === 'NOMATCH') {
            const r = await sql`UPDATE xx_resources SET tmdb_id = 'NOMATCH', last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            return { id: item.id, tmdb_id: r.length ? 'NOMATCH' : null, updateFailed: !r.length };
          }
          if (result) {
            const updResult = await sql`UPDATE xx_resources SET tmdb_id = ${result.id}, matched_tmdb_at = NOW(), last_attempt_at = NOW(), updated_at = NOW() WHERE id = ${item.id} RETURNING id`;
            if (!updResult.length) {
              return { id: item.id, tmdb_id: null, updateFailed: true };
            }
            await cacheIt(result, sql);
            return { id: item.id, tmdb_id: result.id };
          }
          return { id: item.id, tmdb_id: null };
        })
      );
      results.push(...chunkResults);
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
