// 短剧打标数据摸底 - 总量 + 分类分布
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];
const sql = neon(process.env.DATABASE_URL);

// 含短剧 (name 或 tags) 的资源总数
const cnt = await sql`
  SELECT COUNT(*)::int as cnt
  FROM xx_resources
  WHERE status='active'
    AND (
      name ILIKE '%短剧%'
      OR array_to_string(tags, ',') ILIKE '%短剧%'
    )
`;
console.log(`含短剧资源总数: ${cnt[0]?.cnt}`);

// 按 category 分布
const byCat = await sql`
  SELECT category, COUNT(*)::int as cnt
  FROM xx_resources
  WHERE status='active'
    AND (name ILIKE '%短剧%' OR array_to_string(tags, ',') ILIKE '%短剧%')
  GROUP BY category
  ORDER BY cnt DESC
`;
console.log('\n=== 按 category 分布 ===');
for (const r of byCat) console.log(`  ${r.category}: ${r.cnt}`);

// 按 import_channel 分布
const byCh = await sql`
  SELECT import_channel, COUNT(*)::int as cnt
  FROM xx_resources
  WHERE status='active'
    AND (name ILIKE '%短剧%' OR array_to_string(tags, ',') ILIKE '%短剧%')
  GROUP BY import_channel
  ORDER BY cnt DESC
`;
console.log('\n=== 按 import_channel 分布 ===');
for (const r of byCh) console.log(`  ${r.import_channel || 'null'}: ${r.cnt}`);

// 按 access_tier 分布
const byTier = await sql`
  SELECT access_tier, COUNT(*)::int as cnt
  FROM xx_resources
  WHERE status='active'
    AND (name ILIKE '%短剧%' OR array_to_string(tags, ',') ILIKE '%短剧%')
  GROUP BY access_tier
  ORDER BY cnt DESC
`;
console.log('\n=== 按 access_tier 分布 ===');
for (const r of byTier) console.log(`  ${r.access_tier || 'null'}: ${r.cnt}`);

// 匹配到 TMDB 的有多少
const withTmdb = await sql`
  SELECT COUNT(*)::int as cnt
  FROM xx_resources r
  WHERE r.status='active'
    AND (r.name ILIKE '%短剧%' OR array_to_string(r.tags, ',') ILIKE '%短剧%')
    AND r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id != 'NOMATCH'
`;
console.log(`\n含短剧且有 TMDB id: ${withTmdb[0]?.cnt}`);
