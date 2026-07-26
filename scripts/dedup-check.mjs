// TG JSON 预分析 + DB 去重检查
// 用途: 导入前跑这个, 看哪些 link 已在 DB (重复), 哪些会真入库
// 用法: node scripts/dedup-check.mjs <result.json>
import { readFileSync } from 'fs';
import { neon } from '@neondatabase/serverless';
import { detectCategoryByTitle, detectSource, extractLinksFromTgMessage, extractTitleFromTgMessage } from '../src/lib/import-classifier.ts';

const path = process.argv[2];
if (!path) {
  console.error('用法: node scripts/dedup-check.mjs <result.json>');
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 需要 DATABASE_URL 环境变量');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const json = JSON.parse(readFileSync(path, 'utf-8'));
const messages = json.messages || [];

// 收集所有 link + category
const items = [];
for (const msg of messages) {
  if (msg.type !== 'message') continue;
  let title = '';
  try { title = extractTitleFromTgMessage(msg); } catch {}
  if (!title) {
    let textStr = '';
    if (typeof msg.text === 'string') textStr = msg.text;
    else if (Array.isArray(msg.text)) {
      for (const t of msg.text) {
        if (typeof t === 'string') textStr += t + '\n';
        else if (t && typeof t.text === 'string') textStr += t.text + '\n';
      }
    }
    const lines = textStr.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/(https?:\/\/|magnet:\?|ed2k:\/\/)/.test(line)) { title = line.slice(0, 200); break; }
    }
  }
  const links = extractLinksFromTgMessage(msg);
  if (links.length === 0) continue;
  const primaryLink = links[0].url;
  const primarySource = detectSource(primaryLink);
  const cat = detectCategoryByTitle(title || '', '其他', primarySource);
  items.push({ title, primaryLink, primarySource, cat });
}

console.log(`📊 总带链接消息: ${items.length}`);

// 单条查 DB (准确, 慢但稳)
const existingSet = new Set();
for (let i = 0; i < items.length; i++) {
  const link = items[i].primaryLink;
  const r1 = await sql`SELECT link FROM xx_resources WHERE link = ${link} LIMIT 1`;
  if (r1[0]) { existingSet.add(link); continue; }
  const r2 = await sql`SELECT url FROM xx_resource_links WHERE url = ${link} LIMIT 1`;
  if (r2[0]) existingSet.add(link);
  if ((i+1) % 50 === 0) process.stdout.write(`\r  查 ${i+1}/${items.length}...`);
}
process.stdout.write('\n');

const newOnes = items.filter(i => !existingSet.has(i.primaryLink));
const dupes = items.length - newOnes.length;
console.log(`\n=== 重复率 ${(dupes/items.length*100).toFixed(1)}% ===`);
console.log(`  重复: ${dupes}`);
console.log(`  新: ${newOnes.length}`);

// 新的按 category 分布
const newByCat = {};
for (const i of newOnes) newByCat[i.cat] = (newByCat[i.cat] || 0) + 1;
console.log('\n=== 真正新资源按 category ===');
for (const [k, v] of Object.entries(newByCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v}`);
}

// 列出"其他"里真正新的 (要重点看的)
const newOthers = newOnes.filter(i => i.cat === '其他');
if (newOthers.length > 0) {
  console.log(`\n=== 真正新且归"其他"的 (${newOthers.length} 条) ===`);
  for (const o of newOthers.slice(0, 30)) {
    console.log(`  [${o.primarySource}] ${o.title?.slice(0, 60)} => ${o.primaryLink?.slice(0, 50)}`);
  }
}

console.log(`\n💡 总结: ${newOnes.length} 条会真入库 (${dupes} 重复跳过)`);
process.exit(0);
