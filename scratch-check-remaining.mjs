// 看实际剩多少
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

const r1 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
console.log('remaining dmhy main:', r1[0]?.cnt);

const r2 = await sql`SELECT MIN(id) as min_id, MAX(id) as max_id FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
console.log('min/max id:', r2);

// 看前 5 个剩的
const r3 = await sql`SELECT id, name, link FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%' ORDER BY id ASC LIMIT 5`;
console.log('first 5:', r3);

const r4 = await sql`SELECT id, name, link FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%' ORDER BY id DESC LIMIT 5`;
console.log('last 5:', r4);

// 看副表
const r5 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE source = '115' AND url ILIKE '%dmhy%'`;
console.log('sub links dmhy:', r5[0]?.cnt);

process.exit(0);
