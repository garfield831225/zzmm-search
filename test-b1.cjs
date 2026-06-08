const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://x:x@x/x');
// 模拟 b1 SQL: params.length=7 (cats=movie 7个) 但 SQL 里没用到 cats 的 $N
const cats = ['电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影'];
const params = [...cats];
const resourceWhere = `r.status = 'active' AND r.category IN (${cats.map((_, i) => `'${cats[i].replace(/'/g, "''")}'`).join(',')}) AND r.source = '115'`;
const type = 'movie';
const limit1 = 500;
const offset1 = 0;
const q = `WITH matched AS (SELECT r.tmdb_id::int FROM xx_resources r WHERE ${resourceWhere} GROUP BY r.tmdb_id) SELECT m.tmdb_id FROM matched m LEFT JOIN xx_tmdb_discover d ON d.tmdb_id = m.tmdb_id AND d.tmdb_type = $${params.length + 1} LIMIT $${params.length + 2} OFFSET $${params.length + 3}`;
const m = sql(q, [...params, type, limit1, offset1]);
console.log('q:', q);
console.log('pq:', JSON.stringify(m.parameterizedQuery));
