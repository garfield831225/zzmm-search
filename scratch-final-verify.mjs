// 验证 dmhy 清理最终结果
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

const r1 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
console.log('主表 dmhy 资源 remaining:', r1[0]?.cnt);

const r2 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE source = '115' AND url ILIKE '%dmhy%'`;
console.log('副表 dmhy 链接 remaining:', r2[0]?.cnt);

// 看这 3 条剩的是什么
const r3 = await sql`SELECT id, resource_id, source, url, sort FROM xx_resource_links WHERE source = '115' AND url ILIKE '%dmhy%'`;
console.log('副表 3 条 sample:', r3);

const r4 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115'`;
console.log('主表 source=115 total:', r4[0]?.cnt);

const r5 = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resources GROUP BY source ORDER BY cnt DESC LIMIT 10`;
console.log('主表 source 分布 (top 10):', r5);

const r6 = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resource_links GROUP BY source ORDER BY cnt DESC LIMIT 10`;
console.log('副表 source 分布 (top 10):', r6);

process.exit(0);
