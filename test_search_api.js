const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  // 模拟 search API: zone=film, category=全部, 无查询, no year filter
  // 条件: status=active, category NOT IN (音乐,体育,游戏,电子书,精品课,文档)
  const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

  const cnt_sql = `SELECT COUNT(*) as cnt FROM xx_resources r
    LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
    WHERE r.status = 'active' AND r.category != ALL($1)`;

  const cnt = await s(cnt_sql, [NONFILM_CATS]);
  console.log('Total with film zone filter:', cnt[0]?.cnt);

  // Page 1
  const r1 = await s`SELECT r.id, r.name, r.category, c.release_date,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
    COALESCE(c.release_date, r.created_at::text) as sort_date
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE r.status = 'active' AND r.category != ALL(${NONFILM_CATS})
   ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
   LIMIT 30 OFFSET 0`;
  console.log('Page 1 count:', r1.length, '| first:', r1[0]?.name?.slice(0,20));

  // Page 2 - exact same query with OFFSET 30
  const r2 = await s`SELECT r.id, r.name, r.category, c.release_date,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
    COALESCE(c.release_date, r.created_at::text) as sort_date
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE r.status = 'active' AND r.category != ALL(${NONFILM_CATS})
   ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
   LIMIT 30 OFFSET 30`;
  console.log('Page 2 count:', r2.length, '| first:', r2[0]?.name?.slice(0,20));
  if (r2.length > 0) console.log('IDs:', r2.map(x => x.id));

  // Also test: order by ONLY created_at (no tmdb stuff)
  const r2b = await s`SELECT r.id, r.name FROM xx_resources r
   WHERE r.status = 'active' AND r.category != ALL(${NONFILM_CATS})
   ORDER BY r.created_at DESC LIMIT 30 OFFSET 30`;
  console.log('Page 2 (created_at only) count:', r2b.length, '| first:', r2b[0]?.name?.slice(0,20));
})().catch(console.error);
