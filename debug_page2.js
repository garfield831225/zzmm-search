const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  // 模拟 search API 的分页逻辑（ORDER BY release_date DESC）
  const r = await s`SELECT r.id, r.name, r.category, c.release_date, r.created_at
     FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE r.status='active'
     ORDER BY c.release_date DESC NULLS LAST, r.created_at DESC
     OFFSET 30 LIMIT 30`;
  console.log('Page 2 items (offset 30, limit 30):', r.length);
  r.forEach(x => console.log(x.id, '|', x.name.slice(0, 30)));
})().catch(console.error);
