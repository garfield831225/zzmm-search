// 通用 TG result.json 预分析工具
// 用途: 导入前先跑这个, 看看有多少资源会归"其他", 哪些建议扩关键词
// 用法: node scripts/analyze-tg-json.mjs <path-to-result.json>
import { readFileSync } from 'fs';
import { detectCategoryByTitle, detectSource, extractLinksFromTgMessage, extractTitleFromTgMessage } from '../src/lib/import-classifier.ts';

const path = process.argv[2];
if (!path) {
  console.error('用法: node scripts/analyze-tg-json.mjs <result.json>');
  process.exit(1);
}

const json = JSON.parse(readFileSync(path, 'utf-8'));
const messages = json.messages || [];
console.log(`📊 总消息数: ${messages.length}\n`);

const all = [];
const others = [];
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
  const rec = { title, primaryLink, primarySource, cat };
  all.push(rec);
  if (cat === '其他') others.push(rec);
}

console.log('=== 全量分类 ===');
const byCat = {}, bySrc = {};
for (const m of all) {
  byCat[m.cat] = (byCat[m.cat] || 0) + 1;
  bySrc[m.primarySource] = (bySrc[m.primarySource] || 0) + 1;
}
for (const [k, v] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  const pct = (v / all.length * 100).toFixed(1);
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(5)} (${pct}%)`);
}
console.log('\n=== 按 source ===');
for (const [k, v] of Object.entries(bySrc).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${v}`);
}

console.log(`\n=== "其他" 共 ${others.length} 条 (${(others.length/all.length*100).toFixed(1)}%) ===\n`);

if (others.length > 0) {
  // 按 source 分布
  const otherBySrc = {};
  for (const o of others) otherBySrc[o.primarySource] = (otherBySrc[o.primarySource] || 0) + 1;
  console.log('"其他"按 source:');
  for (const [k, v] of Object.entries(otherBySrc).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }

  // 抽高频 2-gram 关键词, 给扩库建议
  const wordCount = {};
  for (const o of others) {
    if (!o.title) continue;
    // 抽 2-gram (2-3 字符)
    const t = o.title.replace(/[【】\[\]（）()\.\/\\\d:：\s]/g, ' ');
    const words = t.split(/\s+/).filter(w => w.length >= 2 && w.length <= 8);
    for (const w of words) {
      wordCount[w] = (wordCount[w] || 0) + 1;
    }
  }
  const topWords = Object.entries(wordCount).sort((a, b) => b[1] - a[1]).slice(0, 20);
  console.log('\n"其他"高频词 (top 20, 加到 import-classifier.ts 关键词库):');
  for (const [w, c] of topWords) {
    if (c >= 3) console.log(`  "${w}" x${c}`);
  }

  // 列前 20 条
  console.log('\n"其他"前 20 条样例:');
  for (const o of others.slice(0, 20)) {
    console.log(`  [${o.primarySource}] ${o.title?.slice(0, 50)} => ${o.primaryLink?.slice(0, 50)}`);
  }

  console.log(`\n💡 建议: 1) 跑 node scripts/dedup-check.mjs 看 DB 重复率`);
  console.log(`        2) 把上面高频词加到 src/lib/import-classifier.ts KEYWORD_CATEGORY_RULES`);
  console.log(`        3) 重新 build + 部署, 再跑这个脚本确认"其他"减少`);
}

process.exit(0);
