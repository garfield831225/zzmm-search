// 测试 navFilter 调用方式
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

// 测试 sql(string) 调用
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND ${sql('1=1')}`;
  console.log('sql(string) OK:', JSON.stringify(r));
} catch (e) { console.log('sql(string) err:', e.message); }

// 测一个简单的 (link ILIKE ...) 模式
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND (link ILIKE '%dmhy%' OR link ILIKE '%anoneko%')`;
  console.log('hardcoded OR OK:', JSON.stringify(r));
} catch (e) { console.log('hardcoded err:', e.message); }

process.exit(0);
