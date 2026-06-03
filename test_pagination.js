const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  // 模拟 search API SQL: page 1
  const r1 = await s`SELECT r.id, r.name,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
    COALESCE(c.release_date, r.created_at::text) as sort_date
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE r.status = 'active'
   ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
   LIMIT 30 OFFSET 0`;
  console.log('Page 1 count:', r1.length, '| first:', r1[0]?.name?.slice(0, 20));

  // page 2
  const r2 = await s`SELECT r.id, r.name,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
    COALESCE(c.release_date, r.created_at::text) as sort_date
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE r.status = 'active'
   ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
   LIMIT 30 OFFSET 30`;
  console.log('Page 2 count:', r2.length, '| first:', r2[0]?.name?.slice(0, 20));

  // page 3
  const r3 = await s`SELECT r.id, r.name FROM xx_resources r
   WHERE r.status = 'active'
   ORDER BY r.created_at DESC
   LIMIT 30 OFFSET 60`;
  console.log('Page 3 count (created_at order):', r3.length, '| first:', r3[0]?.name?.slice(0, 20));
})().catch(console.error);
