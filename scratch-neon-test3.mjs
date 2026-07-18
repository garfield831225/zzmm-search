// 测试 string 嵌入 sql template
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

const whereClause = `(link ILIKE '%dmhy.org%' OR link ILIKE '%anoneko.com%')`;

// 方法 1: 字符串嵌入 template
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND ${whereClause}`;
  console.log('1. template embed OK:', JSON.stringify(r));
} catch (e) { console.log('1. err:', e.message); }

// 方法 2: sql.raw
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND ${sql.raw(whereClause)}`;
  console.log('2. sql.raw OK:', JSON.stringify(r));
} catch (e) { console.log('2. sql.raw err:', e.message); }

// 方法 3: 直接 unsafe?
try {
  const r = await sql.unsafe(`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND ${whereClause}`);
  console.log('3. sql.unsafe OK:', JSON.stringify(r));
} catch (e) { console.log('3. sql.unsafe err:', e.message); }

process.exit(0);
