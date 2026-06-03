const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

async function test() {
  const page = 2;
  const pageSize = 30;
  const conditions = [`r.status = 'active'`];
  const params = [];
  let idx = 1;

  for (const cat of NONFILM_CATS) {
    conditions.push(`category != $${idx++}`);
    params.push(cat);
  }
  // idx = 7
  const dbConditions = [...conditions];
  const dbWhere = dbConditions.join(' AND ');
  const offset = (page - 1) * pageSize;
  const dbParams = [...params, pageSize, offset];

  console.log('dbWhere:', dbWhere);
  console.log('dbParams len:', dbParams.length, '| values:', dbParams);
  console.log('idx for LIMIT:', idx, '| LIMIT $' + idx + ' OFFSET $' + (idx+1));

  // 完全复制 search API 的 sql() raw call 方式
  const orderBy = 'has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC';
  const sqlStr = `SELECT r.id, r.name, r.category, COALESCE(c.release_date, r.created_at::text) as sort_date,
    CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
   FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
   WHERE ${dbWhere} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx+1}`;

  console.log('SQL:', sqlStr);
  console.log('Params count:', dbParams.length);

  const rows = await sql(sqlStr, dbParams);
  console.log('Rows:', rows.length);
  if (rows.length > 0) console.log('First:', rows[0].name);
  else console.log('EMPTY!');
}

test().catch(console.error);
