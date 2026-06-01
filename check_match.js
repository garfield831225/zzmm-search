require('dotenv').config();
const { neon } = require('@neondatabase/serverless');
const s = neon(process.env.DATABASE_URL);

(async () => {
  const u = await s`SELECT COUNT(*) as c FROM xx_resources WHERE (tmdb_id IS NULL OR tmdb_id = '') AND status = 'active'`;
  console.log('未匹配资源:', u[0]?.c);

  const m = await s`SELECT COUNT(*) as c FROM xx_tmdb_cache WHERE poster_path IS NOT NULL AND poster_path != ''`;
  console.log('有海报的TMDB缓存:', m[0]?.c);

  const p = await s`SELECT r.id, r.name, r.category, c.poster_path FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE r.status = 'active' AND r.tmdb_id IS NOT NULL AND r.tmdb_id != '' ORDER BY r.id DESC LIMIT 5`;
  p.forEach(x => console.log(x.id, x.name?.slice(0, 30), x.category, x.poster_path?.slice(0, 20)));
})().catch(console.error);
