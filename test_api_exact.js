const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

async function test() {
  const conditions = [`r.status = 'active'`];
  const params = [];
  let idx = 1;

  // zone=film, category=全部
  for (const cat of NONFILM_CATS) {
    conditions.push(`r.category != $${idx++}`);
    params.push(cat);
  }
  // idx = 7

  const dbWhere = conditions.join(' AND ');
  const page = 2;
  const pageSize = 30;
  const offset = (page - 1) * pageSize; // 30

  // The exact SQL from the new search route
  const dbParams = [...params, pageSize, offset];
  const dbRows = await sql(
    `SELECT r.id, r.name, r.category,
      COALESCE(c.release_date, r.created_at::text) as sort_date,
      CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
     FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
     WHERE ${dbWhere}
     ORDER BY has_tmdb DESC, sort_date DESC NULLS LAST, r.created_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    dbParams
  );

  console.log('dbWhere:', dbWhere);
  console.log('params len:', dbParams.length, '| params:', dbParams);
  console.log('idx for LIMIT:', idx, '| LIMIT $' + idx + ' OFFSET $' + (idx+1));
  console.log('dbRows length:', dbRows.length);
  if (dbRows.length > 0) {
    console.log('First row:', JSON.stringify({ id: dbRows[0].id, name: dbRows[0].name?.slice(0,30), has_tmdb: dbRows[0].has_tmdb }));
  } else {
    // Try simpler query
    const simple = await sql(
      `SELECT id, name FROM xx_resources r WHERE r.status = 'active' ORDER BY r.created_at DESC LIMIT 5`
    );
    console.log('Simple query (no joins, no conditions):', simple.length, '| first:', simple[0]?.name);

    // Try with the exact WHERE but without ORDER BY
    const noOrder = await sql(
      `SELECT r.id, r.name FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${dbWhere} LIMIT 5`,
      params
    );
    console.log('With WHERE but no ORDER BY:', noOrder.length);
  }
}

test().catch(console.error);
