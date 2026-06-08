const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://x:x@x/x');
// 1. sql('string') 字符串调用
const s1 = sql('SELECT 1');
console.log('1. sql(string):', typeof s1, s1.parameterizedQuery ? 'has pq' : 'no pq');
// 2. sql\`template\` 模板调用
const s2 = sql`SELECT ${1}::int`;
console.log('2. sql`template`:', typeof s2, s2.parameterizedQuery ? 'has pq' : 'no pq');
// 3. sql.fragment('string') 是否有 fragment 接口?
console.log('3. sql keys:', Object.keys(sql));
console.log('4. sql has own fragment?', typeof sql.fragment);
