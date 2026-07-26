// 重分类脚本: 跑新关键词库对已入库的"待归类"资源重新分类
// 用法: node scripts/reclassify-pending.mjs [--dry-run]
// 默认 dry-run (只看不改), 传 --do 才真改 DB
import { neon } from '@neondatabase/serverless';
import { detectCategoryByTitle, detectSource } from '../src/lib/import-classifier.ts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 需要 DATABASE_URL');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const dryRun = !process.argv.includes('--do');
console.log(dryRun ? '🔍 DRY RUN (不写 DB)' : '⚠️  真实写 DB 模式');
console.log('');

// 1. 查所有待归类
const rows = await sql`
  SELECT id, name, source, link
  FROM xx_resources
  WHERE status='active' AND category='其他'
    AND source IN ('baidu','quark','aliyun','115','uc','xunlei','123','tianyi','yidong','magnet','ed2k')
  ORDER BY id DESC
`;
console.log(`待归类资源: ${rows.length} 条`);

// 2. 跑新关键词库, 统计会被重分类
const changes = [];
let keep = 0;
for (const r of rows) {
  const newCat = detectCategoryByTitle(r.name || '', '其他', r.source);
  if (newCat !== '其他') {
    changes.push({ id: r.id, name: r.name, from: '其他', to: newCat });
  } else {
    keep++;
  }
}

console.log(`会被重分类: ${changes.length} 条`);
console.log(`保持"其他": ${keep} 条`);
console.log('');

// 3. 按目标 category 统计
const byTarget = {};
for (const c of changes) byTarget[c.to] = (byTarget[c.to] || 0) + 1;
console.log('重分类目标分布:');
for (const [k, v] of Object.entries(byTarget).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// 4. 列出前 10 样例
console.log('\n前 10 样例:');
for (const c of changes.slice(0, 10)) {
  console.log(`  id=${c.id} ${c.from}→${c.to}: ${c.name?.slice(0, 50)}`);
}

if (dryRun) {
  console.log('\n💡 加 --do 参数真实执行: node scripts/reclassify-pending.mjs --do');
  process.exit(0);
}

// 5. 真改: 按 category 分批 UPDATE
console.log('\n🚀 开始 UPDATE...');
const byTarget2 = {};
for (const c of changes) {
  if (!byTarget2[c.to]) byTarget2[c.to] = [];
  byTarget2[c.to].push(c.id);
}
let totalUpdated = 0;
for (const [cat, ids] of Object.entries(byTarget2)) {
  // 50 一批
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const orClauses = chunk.map((_, idx) => `id = $${idx + 1}`).join(' OR ');
    const r = await sql(`UPDATE xx_resources SET category = $${chunk.length + 1} WHERE ${orClauses}`, [...chunk, cat]);
    totalUpdated += chunk.length;
    process.stdout.write(`  ${cat}: ${totalUpdated}/${changes.length}\r`);
  }
}
process.stdout.write('\n');
console.log(`✅ 已 UPDATE ${totalUpdated} 条`);

process.exit(0);
