const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

(async () => {
  // 模拟 search API 参数
  const page = 2;
  const pageSize = 30;
  const conditions = [`r.status = 'active'`];
  const params = [];
  let idx = 1;

  // zone=film, category=全部
  for (const cat of NONFILM_CATS) {
    conditions.push(`category != $${idx++}`);
    params.push(cat);
  }
  // idx=7 here

  // year='全部' - 不加 year 条件
  const dbConditions = [...conditions];
  const dbWhere = dbConditions.join(' AND ');

  // 模拟 sql() 模板字面量：带 $1-$7 + LIMIT $8 OFFSET $9
  const offset = (page - 1) * pageSize; // 30
  const dbParams = [...params, pageSize, offset]; // 9个元素: idx 1-7 是上面params, idx 8=pageSize, idx 9=offset

  console.log('idx final:', idx); // 应该是7
  console.log('dbParams length:', dbParams.length); // 应该是9
  console.log('dbParams:', dbParams); // [status, 6 cats, 30, 30]
  console.log('conditions count:', conditions.length); // 应该是7

  // 直接用 Neon sql() 执行，看 LIMIT/OFFSET 的 $8/$9 能不能正确处理
  const dbRows = await s`SELECT r.id, r.name, r.category,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb,
    COALESCE(c.release_date, r.created_at::text) as sort_date
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE ${s(dbWhere)} AND r.category != ${params[0]} AND r.category != ${params[1]} AND r.category != ${params[2]}
   ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
   LIMIT ${pageSize} OFFSET ${offset}`;

  console.log('Rows returned:', dbRows.length);
  if (dbRows.length > 0) console.log('First:', dbRows[0].name);
  else console.log('EMPTY! - check dbWhere:', dbWhere);
})().catch(console.error);
