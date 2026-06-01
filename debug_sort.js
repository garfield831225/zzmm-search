const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  const r = await s`SELECT r.id, r.name, r.category, c.release_date, c.title, r.created_at, r.tmdb_id
     FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE r.status='active' AND r.category IN ('连载','电影')
     ORDER BY c.release_date DESC NULLS LAST, r.created_at DESC LIMIT 15`;
  r.forEach(x => console.log(x.release_date, '|', x.name.slice(0,25), '|', x.category, '|', x.tmdb_id));
})().catch(console.error);
