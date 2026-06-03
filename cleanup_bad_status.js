const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  const bad = await s`
    SELECT r.id FROM xx_resources r JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE r.status = 'active' AND r.tmdb_id IS NOT NULL AND r.tmdb_id != ''
       AND ((c.tmdb_type = 'tv' AND c.status IN ('Returning Series', 'In Production', 'Planned'))
         OR (c.tmdb_type = 'movie' AND c.status IN ('In Production', 'Planned')))
     LIMIT 100
  `;

  console.log('待清理:', bad.length);
  if (bad.length === 0) return;

  const ids = bad.map(r => r.id);

  // 方法1: 模板标签 + ANY()
  try {
    const r1 = await s`UPDATE xx_resources SET tmdb_id = NULL WHERE id = ANY(${ids})`;
    console.log('方法1 (ANY + 模板):', JSON.stringify(r1));
  } catch (e) { console.log('方法1 failed:', e.message); }

  // 方法2: 简单 IN，用 INLINE id 字符串拼接
  const idList = ids.join(',');
  try {
    const r2 = await s(`UPDATE xx_resources SET tmdb_id = NULL WHERE id IN (${idList})`);
    console.log('方法2 (IN inline):', JSON.stringify(r2));
  } catch (e) { console.log('方法2 failed:', e.message); }

  // 验证
  const remain = await s`
    SELECT COUNT(*)::int as cnt FROM xx_resources r JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE r.status = 'active' AND r.tmdb_id IS NOT NULL AND r.tmdb_id != ''
       AND ((c.tmdb_type = 'tv' AND c.status IN ('Returning Series', 'In Production', 'Planned'))
         OR (c.tmdb_type = 'movie' AND c.status IN ('In Production', 'Planned')))
  `;
  console.log('剩余待清理:', remain[0]?.cnt);
})().catch(console.error);
