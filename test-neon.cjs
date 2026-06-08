const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://x:x@x/x');
const t = sql`SELECT ${'movie'} as v`;
console.log('template:', JSON.stringify({ pq: t.parameterizedQuery, hasThen: typeof t.then }));
const s = sql('SELECT 1');
console.log('string:', JSON.stringify({ pq: s.parameterizedQuery, hasThen: typeof s.then }));
const m = sql('SELECT $1::text', ['hello']);
console.log('mixed:', JSON.stringify({ pq: m.parameterizedQuery, hasThen: typeof m.then }));
