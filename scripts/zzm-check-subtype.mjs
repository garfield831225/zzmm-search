// 查动漫 sub_type 实际值 + 漏判情况
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];

const sql = neon(process.env.DATABASE_URL);

// 1. 动漫 sub_type 分布
const subTypes = await sql`
  SELECT sub_type, COUNT(*) as cnt
  FROM xx_resources
  WHERE status = 'active'
    AND category = '动漫'
    AND sub_type IS NOT NULL AND sub_type != ''
  GROUP BY sub_type
  ORDER BY cnt DESC
`;
console.log('=== 动漫 sub_type 分布 ===');
for (const r of subTypes) console.log(`  ${r.sub_type || '(null)'}: ${r.cnt}`);

// 2. 没匹配动漫的 sub_type 分布 (7 天内)
const unmatchedAnime = await sql`
  SELECT sub_type, COUNT(*) as cnt
  FROM xx_resources
  WHERE status = 'active'
    AND category = '动漫'
    AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH')
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY sub_type
  ORDER BY cnt DESC
`;
console.log('\n=== 没匹配动漫 sub_type 分布 (7 天) ===');
for (const r of unmatchedAnime) console.log(`  ${r.sub_type || '(null)'}: ${r.cnt}`);

// 3. 电影的 sub_type (看 subTypeToTmdb 漏判)
const movieSubTypes = await sql`
  SELECT sub_type, COUNT(*) as cnt
  FROM xx_resources
  WHERE status = 'active'
    AND category = '电影'
    AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH')
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY sub_type
  ORDER BY cnt DESC
  LIMIT 10
`;
console.log('\n=== 没匹配电影 sub_type 分布 (7 天) ===');
for (const r of movieSubTypes) console.log(`  ${r.sub_type || '(null)'}: ${r.cnt}`);

// 4. 跑 subTypeToTmdb 看漏了哪些
function subTypeToTmdbWithExtension(subType) {
  if (!subType) return 'movie';
  const s = subType.toLowerCase();
  if (['剧集', '韩剧', '欧美剧', '港台剧', '国产剧', '日剧', '动漫', '动画', '综艺', '纪录片', '少儿', '演唱会', '连载'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}

console.log('\n=== subTypeToTmdb 漏判 ===');
const allUnmatched = await sql`
  SELECT name, sub_type
  FROM xx_resources
  WHERE status = 'active'
    AND (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id = 'NOMATCH')
    AND created_at > NOW() - INTERVAL '7 days'
    AND sub_type IS NOT NULL AND sub_type != ''
    AND category IN ('电影', '剧集', '动漫', '纪录片', '综艺', '连载')
  ORDER BY id DESC
  LIMIT 1000
`;
let wrongType = 0;
const wrongSample = [];
for (const r of allUnmatched) {
  if (subTypeToTmdbWithExtension(r.sub_type) === 'movie' && /动画|TV|OVA|剧场版|剧场|ova/i.test(r.sub_type)) {
    wrongType++;
    if (wrongSample.length < 5) wrongSample.push(r);
  }
}
console.log(`  漏判数: ${wrongType} / ${allUnmatched.length}`);
console.log('  漏判样本:');
for (const r of wrongSample) {
  console.log(`    sub_type=${r.sub_type} | name=${r.name.slice(0, 60)}`);
}
