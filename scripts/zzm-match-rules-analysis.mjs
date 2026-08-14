// 匹配规则本地分析: 看 cleanFolderName 在真实数据上跑出什么
// 不调 TMDB API, 只看 cleanName 输出质量
// 2026-08-14: 聚焦 电影/电视剧/动漫/纪录片/真人秀 (5 个目标类型)
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];

// 复用 lib/match-engine.ts 的逻辑 (这是原代码, 跑之前先复刻 inline)
// 但为了不复制 540 行, 改用 import
const { cleanFolderName, isGarbled } = await import(new URL('../src/lib/match-engine.ts', import.meta.url).href);

const sql = neon(process.env.DATABASE_URL);

// 1. 拿 7 天内入库 + 没匹配的 1000 条 (聚焦 电影/电视剧/动漫/纪录片/真人秀)
console.log('=== 1. 取 7 天没匹配资源 (仅 电影+电视剧+动漫+纪录片+真人秀) 1000 条 ===');
const TARGET_CATS = ['电影', '华语电影', '外语电影', '动画电影', 'REMUX', '系列电影', '剧集', '连载', '动漫', '综艺', '少儿频道', '纪录片'];
const rows = await sql`
  SELECT id, name, category, sub_type, source, created_at
  FROM xx_resources
  WHERE status = 'active'
    AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH')
    AND created_at > NOW() - INTERVAL '7 days'
    AND name IS NOT NULL AND name != ''
    AND category = ANY(${TARGET_CATS})
  ORDER BY id DESC
  LIMIT 1000
`;
console.log(`取到 ${rows.length} 条 (含 5 个目标类型)`);

// 按 category 分桶统计
const byCategory = {};
for (const r of rows) {
  byCategory[r.category] = (byCategory[r.category] || 0) + 1;
}
console.log('  分类分布:');
for (const [cat, cnt] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${cat}: ${cnt}`);
}

// 2. 跑 cleanFolderName 看 cleanName
const stats = {
  garbled: 0,
  emptyClean: 0,        // cleanName 空
  tooShort: 0,          // cleanName < 2
  hasEnglish: 0,
  hasChinese: 0,
  pureEnglish: 0,
  hasQualitySuffix: 0,  // 还能匹配出 4K/1080p 等
  hasSeason: 0,
  cleanLenAvg: 0,
};

const problems = new Map();  // 失败原因 -> 数量
const sampleProblems = new Map();  // 失败原因 -> 1 个样本

function hasQualitySuffix(s) {
  return /\b(4K|8K|1080p|720p|2160p|480p|BluRay|Blu-?ray|BDMV|REMUX|HDTV|WEB-?DL|HEVC|x\.?264|x\.?265|HDR10?|Dolby\s*Vision|Dolby\s*Atmos|TrueHD|Atmos|DTS-?HD|DTS|AVC|高码|高码率|杜比|IMAX|导演剪辑|终极版|加长版|特别版|抢先版|国语|中字)\b/i.test(s);
}

let totalCleanLen = 0;
for (const r of rows) {
  if (isGarbled(r.name)) { stats.garbled++; continue; }
  const { cleanName, year, season } = cleanFolderName(r.name);
  totalCleanLen += cleanName.length;
  if (season !== null) stats.hasSeason++;
  if (!cleanName) { stats.emptyClean++; problems.set('emptyClean', (problems.get('emptyClean') || 0) + 1); sampleProblems.set('emptyClean', r.name); continue; }
  if (cleanName.length < 2) { stats.tooShort++; problems.set('tooShort', (problems.get('tooShort') || 0) + 1); sampleProblems.set('tooShort', r.name); continue; }
  if (hasQualitySuffix(cleanName)) { stats.hasQualitySuffix++; problems.set('hasQualitySuffix', (problems.get('hasQualitySuffix') || 0) + 1); if (!sampleProblems.has('hasQualitySuffix')) sampleProblems.set('hasQualitySuffix', r.name); }
  if (/[\u4e00-\u9fff]/.test(cleanName)) stats.hasChinese++;
  else stats.pureEnglish++;
}
stats.cleanLenAvg = (totalCleanLen / rows.length).toFixed(1);

// 3. 输出统计
console.log('\n=== 2. cleanFolderName 输出质量 ===');
console.log(`  garbled (乱码):          ${stats.garbled} (${(stats.garbled/rows.length*100).toFixed(1)}%)`);
console.log(`  emptyClean:              ${stats.emptyClean} (${(stats.emptyClean/rows.length*100).toFixed(1)}%)`);
console.log(`  tooShort (< 2):          ${stats.tooShort} (${(stats.tooShort/rows.length*100).toFixed(1)}%)`);
console.log(`  hasQualitySuffix:        ${stats.hasQualitySuffix} (${(stats.hasQualitySuffix/rows.length*100).toFixed(1)}%)`);
console.log(`  hasChinese:              ${stats.hasChinese}`);
console.log(`  pureEnglish:             ${stats.pureEnglish}`);
console.log(`  hasSeason (检出 Sxx):    ${stats.hasSeason}`);
console.log(`  cleanName 平均长度:      ${stats.cleanLenAvg}`);

console.log('\n=== 3. 失败样本 ===');
for (const [reason, count] of problems) {
  console.log(`  ${reason}: ${count} 条`);
  console.log(`    样本: ${sampleProblems.get(reason)}`);
}

// 4. 找常见的 quality suffix 漏掉的
console.log('\n=== 4. 找 quality suffix 漏掉的 (cleanName 还含 4K/1080p) ===');
const qualitySamples = rows.filter(r => {
  if (isGarbled(r.name)) return false;
  const { cleanName } = cleanFolderName(r.name);
  return cleanName && hasQualitySuffix(cleanName);
}).slice(0, 10);
for (const r of qualitySamples) {
  const { cleanName } = cleanFolderName(r.name);
  console.log(`  原: ${r.name.slice(0, 80)}`);
  console.log(`  清: ${cleanName.slice(0, 60)}`);
  console.log();
}

// 5. 找 subTypeToTmdb 漏掉的 (有 season 应该是 tv)
console.log('\n=== 5. season 命中但 category 不是剧集 (subTypeToTmdb 漏判) ===');
const seasonButMovie = rows.filter(r => {
  if (isGarbled(r.name)) return false;
  const { season } = cleanFolderName(r.name);
  return season !== null && !['剧集','连载','动漫','综艺','纪录片','少儿频道','演唱会'].includes(r.category);
}).slice(0, 10);
for (const r of seasonButMovie) {
  const { cleanName, season } = cleanFolderName(r.name);
  console.log(`  category=${r.category} subType=${r.sub_type} season=${season} name=${r.name.slice(0, 60)}`);
  console.log(`    clean: ${cleanName}`);
}

// 6. 找电影/剧集失败原因按类分桶 (聚焦 5 个目标类型)
console.log('\n=== 6. 按 category 分桶的失败原因 (电影+剧集) ===');
for (const cat of ['电影', '剧集', '动漫', '纪录片', '综艺', '连载', '华语电影', '外语电影', '动画电影']) {
  const catRows = rows.filter(r => r.category === cat);
  if (catRows.length === 0) continue;
  const garbled = catRows.filter(r => isGarbled(r.name)).length;
  const emptyClean = catRows.filter(r => {
    if (isGarbled(r.name)) return false;
    const { cleanName } = cleanFolderName(r.name);
    return !cleanName || cleanName.length < 2;
  }).length;
  const hasQs = catRows.filter(r => {
    if (isGarbled(r.name)) return false;
    const { cleanName } = cleanFolderName(r.name);
    return cleanName && hasQualitySuffix(cleanName);
  }).length;
  console.log(`  ${cat}: 总${catRows.length} | garbled:${garbled} | emptyClean:${emptyClean} | hasQS:${hasQs}`);
}

// 7. 找 top 10 失败样本 (按 category 抽样)
console.log('\n=== 7. 5 类型失败样本 (各 3 条) ===');
for (const cat of ['电影', '剧集', '动漫', '纪录片', '综艺']) {
  const catRows = rows.filter(r => r.category === cat).slice(0, 3);
  if (catRows.length === 0) continue;
  console.log(`\n  [${cat}]`);
  for (const r of catRows) {
    const { cleanName } = cleanFolderName(r.name);
    console.log(`    原: ${r.name.slice(0, 80)}`);
    console.log(`    清: ${cleanName || '(empty)'}`);
  }
}
