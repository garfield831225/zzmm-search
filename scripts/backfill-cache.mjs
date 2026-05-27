import { neon } from '@neondatabase/serverless';

const TMDB_KEY = process.env.TMDB_API_KEY || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '200');
const DRY_RUN = process.env.DRY_RUN === 'true';
const CONCURRENCY = 10;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

console.log('[backfill] dry_run=' + DRY_RUN + ' batch_size=' + BATCH_SIZE);

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  const rows = await sql`
    SELECT DISTINCT r.tmdb_id
    FROM xx_resources r
    WHERE r.tmdb_id IS NOT NULL
      AND r.tmdb_id NOT IN ('GARBLED', 'NOMATCH')
      AND NOT EXISTS (
        SELECT 1 FROM xx_tmdb_cache c WHERE c.tmdb_id = r.tmdb_id
      )
    LIMIT ${BATCH_SIZE}
  `;

  if (!rows.length) {
    console.log('[backfill] DONE: no records need backfill');
    process.exit(0);
  }

  console.log('[backfill] Found ' + rows.length + ' tmdb_ids to backfill');

  let cached = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (row) => {
        const tmdbId = row.tmdb_id;
        const url = TMDB_BASE + '/movie/' + tmdbId + '?api_key=' + TMDB_KEY + '&language=zh-CN';
        try {
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) {
            console.warn('[backfill] ' + tmdbId + ' status=' + res.status);
            return false;
          }
          const d = await res.json();
          if (!d || !d.id) {
            console.warn('[backfill] ' + tmdbId + ' no data');
            return false;
          }
          const posterUrl = d.poster_path ? 'https://image.tmdb.org/t/p/w500' + d.poster_path : null;
          const genres = d.genres ? d.genres.map(function(g) { return g.name; }).join(',') : '';
          const title = d.title || d.name || '';
          const originalTitle = d.original_title || d.original_name || '';
          const overview = d.overview || '';
          const tagline = d.tagline || '';
          const releaseDate = d.release_date || null;
          const status = d.status || null;
          const voteAvg = d.vote_average || 0;
          const voteCount = d.vote_count || 0;
          if (!DRY_RUN) {
            await sql([
              'INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, overview, poster_path, vote_average, vote_count, release_date, status, tagline, genres, cached_at)',
              'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())',
              'ON CONFLICT (tmdb_id) DO UPDATE SET poster_path = EXCLUDED.poster_path, title = EXCLUDED.title, cached_at = NOW()'
            ].join(' '),
            [tmdbId, 'movie', title, originalTitle, overview, posterUrl, voteAvg, voteCount, releaseDate, status, tagline, genres]);
          }
          console.log('[backfill] cached ' + tmdbId + ': ' + title);
          return true;
        } catch (e) {
          console.warn('[backfill] ' + tmdbId + ' error: ' + e.message);
          return false;
        }
      })
    );
    for (const r of results) {
      if (r) cached++;
      else failed++;
    }
    if (i + CONCURRENCY < rows.length) await sleep(200);
  }

  console.log('[backfill] DONE: cached=' + cached + ' failed=' + failed);
  process.exit(0);
}

main().catch(function(e) { console.error('[backfill] FATAL:', e.message); process.exit(1); });