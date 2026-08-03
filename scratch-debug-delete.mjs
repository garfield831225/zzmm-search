// debug: 单独测删除 5 条
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

// 1. 取 5 个 id
const ids = [441983, 441984, 441985, 441986, 441987];

// 2. 单独尝试删 1 条, 看错误
console.log('Test 1: 删主表 441983 + 它的副表 (FK CASCADE 自动删)');
try {
  const r = await sql`DELETE FROM xx_resources WHERE id = 441983`;
  console.log('  result:', JSON.stringify(r));
} catch (e) { console.log('  err:', e.message); }

console.log('\nTest 2: 查 441983 是否还在');
try {
  const r = await sql`SELECT id FROM xx_resources WHERE id = 441983`;
  console.log('  result:', JSON.stringify(r));
} catch (e) { console.log('  err:', e.message); }

console.log('\nTest 3: 查 441984 副表数');
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = 441984`;
  console.log('  result:', JSON.stringify(r));
} catch (e) { console.log('  err:', e.message); }

console.log('\nTest 4: 删 441984 副表 + 主表');
try {
  await sql`DELETE FROM xx_resource_links WHERE resource_id = 441984`;
  const r = await sql`DELETE FROM xx_resources WHERE id = 441984`;
  console.log('  DELETE xx_resources result:', JSON.stringify(r));
} catch (e) { console.log('  err:', e.message); }

console.log('\nTest 5: after');
try {
  const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%'`;
  console.log('  remaining dmhy:', r[0]?.cnt);
} catch (e) { console.log('  err:', e.message); }

process.exit(0);
