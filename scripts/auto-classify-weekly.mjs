// 每周自动跑: 1) 统计"待归类"区资源, 2) 抽 title 高频词, 3) 跟当前关键词库比对
// 4) 写报告到 logs/auto-classify-YYYY-MM-DD.md
// 5) 列出建议新增的关键词, 给下次 deploy 看
// 用法: node scripts/auto-classify-weekly.mjs
// systemd timer: 每周日 02:00 (zzmm-auto-classify.timer)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌ 需要 DATABASE_URL 环境变量');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

// 1. 读当前关键词库
const classifierPath = join(PROJECT_ROOT, 'src', 'lib', 'import-classifier.ts');
const classifierSrc = readFileSync(classifierPath, 'utf-8');
// 抽所有 patterns: ['...'] 里的字符串
const existingKeywords = new Set();
for (const m of classifierSrc.matchAll(/'([^']+)'/g)) {
  const s = m[1];
  if (s.length >= 1 && s.length <= 20 && !/^[A-Z]/.test(s)) {
    existingKeywords.add(s);
  }
}
console.log(`📚 当前关键词库: ${existingKeywords.size} 个`);

// 2. 查 DB 所有"待归类" (category='其他' + 网盘 source + active)
const rows = await sql`
  SELECT id, name, source
  FROM xx_resources
  WHERE status='active' AND category='其他' AND source IN ('baidu','quark','aliyun','115','uc','xunlei','123','tianyi','yidong','magnet','ed2k')
  ORDER BY id DESC
`;
console.log(`📊 待归类资源: ${rows.length} 条`);

// 3. 抽 title 高频词 (跟 analyze-tg-json.mjs 同款 2-gram)
const wordCount = {};
const wordSamples = {};  // 每个词附带 1 个样例 title
for (const r of rows) {
  const t = (r.name || '').replace(/[【】\[\]（）()\.\/\\\d:：\s,，。、]/g, ' ');
  const words = t.split(/\s+/).filter(w => w.length >= 2 && w.length <= 8);
  for (const w of words) {
    wordCount[w] = (wordCount[w] || 0) + 1;
    if (!wordSamples[w]) wordSamples[w] = r.name;
  }
}

const sorted = Object.entries(wordCount).sort((a, b) => b[1] - a[1]);

// 4. 找"在待归类里高频但不在关键词库"的词 → 建议新关键词
const suggestions = [];
for (const [w, c] of sorted) {
  if (c < 3) continue;
  if (existingKeywords.has(w)) continue;
  // 过滤掉通用词
  if (['http', 'https', 'com', 'cn', 'pan', 'drive', 'share', 'baidu', 'quark'].includes(w.toLowerCase())) continue;
  suggestions.push({ word: w, count: c, sample: wordSamples[w] });
}
console.log(`\n💡 建议新关键词: ${suggestions.length} 个 (count >= 3 且不在关键词库)`);

// 5. 写报告
const today = new Date().toISOString().slice(0, 10);
const logsDir = join(PROJECT_ROOT, 'logs');
if (!existsSync(logsDir)) mkdirSync(logsDir, { recursive: true });
const reportPath = join(logsDir, `auto-classify-${today}.md`);

let md = `# Auto Classify Weekly Report (${today})\n\n`;
md += `## 当前状态\n`;
md += `- 待归类资源: **${rows.length} 条** (网盘 + category='其他' + active)\n`;
md += `- 关键词库大小: ${existingKeywords.size} 个\n\n`;

md += `## 建议新增关键词 (count >= 3 且不在关键词库)\n`;
if (suggestions.length === 0) {
  md += `✅ 没有需要新增的关键词. 待归类资源里的高频词都已经被关键词库覆盖.\n\n`;
} else {
  md += `| 词 | 命中数 | 样例 title |\n`;
  md += `|---|---|---|\n`;
  for (const s of suggestions.slice(0, 30)) {
    md += `| \`${s.word}\` | ${s.count} | ${s.sample?.slice(0, 50)} |\n`;
  }
  md += `\n## 建议操作\n`;
  md += `1. 把上面表格里的词加到 \`src/lib/import-classifier.ts\` KEYWORD_CATEGORY_RULES\n`;
  md += `2. 决定归到哪个 category (电影/剧集/动漫/电子书/文档/...)\n`;
  md += `3. 决定 priority (新词放低, 比如 30-40)\n`;
  md += `4. 写完之后 npm run build + 部署\n`;
  md += `5. 部署后跑 SQL 重分类已入库资源:\n`;
  md += `\`\`\`sql\n`;
  md += `-- 例: 把"稀有资源"从其他 → 电影\n`;
  md += `UPDATE xx_resources SET category='电影' WHERE category='其他' AND name LIKE '%稀有资源%';\n`;
  md += `\`\`\`\n\n`;
}

md += `## 待归类前 20 条 (按 id 倒序)\n`;
for (const r of rows.slice(0, 20)) {
  md += `- id=${r.id} [${r.source}] ${r.name?.slice(0, 60)}\n`;
}

writeFileSync(reportPath, md, 'utf-8');
console.log(`\n📝 报告已写: ${reportPath}`);

// 6. 写"高频词全量"到 JSON (给 admin 一键应用功能)
const jsonPath = join(logsDir, `auto-classify-${today}.json`);
const jsonData = {
  date: today,
  total: rows.length,
  existingKeywords: existingKeywords.size,
  suggestions: suggestions.slice(0, 50),
};
writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
console.log(`📦 JSON 已写: ${jsonPath}`);

console.log('\n=== 完成 ===');
process.exit(0);
