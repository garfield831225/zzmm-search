// 测试 Neon v3 怎么调 raw query
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

// 1. 模板
const r1 = await sql`SELECT 1 as x`;
console.log('r1:', JSON.stringify(r1));

// 2. 字符串拼接 + template
const navDomains = ['%dmhy.org%', '%anoneko.com%', '%share.popgo.org%'];

// 3. 模拟我想要的: 一个 link ILIKE ANY(ARRAY[...]) 模式
const r4 = await sql`
  SELECT id, link FROM xx_resources
  WHERE source = '115' AND link ILIKE ANY(ARRAY[${navDomains.join(',')}]::text[])
  LIMIT 3
`;
console.log('r4:', JSON.stringify(r4));

// 5. 简化: 直接用 OR 拼, 因为是固定列表
const r5 = await sql`
  SELECT id, link FROM xx_resources
  WHERE source = '115'
    AND (link ILIKE '%dmhy.org%' OR link ILIKE '%anoneko.com%' OR link ILIKE '%share.popgo.org%')
  LIMIT 3
`;
console.log('r5:', JSON.stringify(r5));

process.exit(0);
