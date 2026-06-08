const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL || '');
(async () => {
  // 1) xx_resources 里所有 category
  const c1 = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' GROUP BY category ORDER BY cnt DESC`;
  console.log('--- xx_resources category 分布 ---');
  c1.forEach(r => console.log('  ' + (r.category || '(null)').padEnd(20), r.cnt));
  // 2) 连载（category='连载'）里有 tmdb_id 的几个
  const c2 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND category = '连载' AND tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id != 'NOMATCH' AND tmdb_id ~ '^[0-9]+$' AND (tmdb_id)::int > 10000`;
  console.log('--- 连载 已匹配 b1 ---', c2[0]?.cnt);
  const c3 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND category = '连载' AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH')`;
  console.log('--- 连载 未匹配 b2 ---', c3[0]?.cnt);
  // 3) tv × tv 验证
  const c4 = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND category IN ('剧集','连载','动漫','少儿频道','综艺','纪录片') GROUP BY category ORDER BY cnt DESC`;
  console.log('--- tv 类型 6 个 category 分布 ---');
  c4.forEach(r => console.log('  ' + (r.category || '(null)').padEnd(20), r.cnt));
})();
