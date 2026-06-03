const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  // 实际状态：还有多少资源 tmdb_id 指向 Returning Series 等？
  const remain = await s`
    SELECT COUNT(*)::int as cnt
     FROM xx_resources r JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE r.status = 'active' AND r.tmdb_id IS NOT NULL AND r.tmdb_id != ''
       AND ((c.tmdb_type = 'tv' AND c.status IN ('Returning Series', 'In Production', 'Planned'))
         OR (c.tmdb_type = 'movie' AND c.status IN ('In Production', 'Planned')))
  `;
  console.log('总剩余待清理 (tmdb_id 仍指向错误状态):', remain[0]?.cnt);

  // 总览：所有 active 资源中
  const total = await s`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active'`;
  console.log('active 资源总数:', total[0]?.cnt);

  const withTmdb = await s`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND tmdb_id IS NOT NULL AND tmdb_id != ''`;
  console.log('已匹配 tmdb_id:', withTmdb[0]?.cnt);

  const nullTmdb = await s`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND (tmdb_id IS NULL OR tmdb_id = '')`;
  console.log('待匹配 (无 tmdb_id):', nullTmdb[0]?.cnt);
})().catch(console.error);
