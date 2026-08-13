// 看下当前 shortdrama 在数据里长啥样
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];
const sql = neon(process.env.DATABASE_URL);

// 1. 查所有 category 分布
const cats = await sql`
  SELECT category, sub_type, COUNT(*) as cnt
  FROM xx_resources
  WHERE status='active'
  GROUP BY category, sub_type
  ORDER BY cnt DESC
  LIMIT 30
`;
console.log('=== category × sub_type 分布 (top 30) ===');
for (const r of cats) console.log(`  cat=${r.category || 'null'} sub=${r.sub_type || 'null'} cnt=${r.cnt}`);

// 2. 查 name/tag 里含 "短剧" 的
const matches = await sql`
  SELECT id, name, category, sub_type, tags, type, access_tier
  FROM xx_resources
  WHERE (name ILIKE '%短剧%' OR tags::text ILIKE '%短剧%' OR sub_type ILIKE '%短剧%')
    AND status='active'
  LIMIT 20
`;
console.log(`\n=== 含 "短剧" 关键字的 (${matches.length} 条样本) ===`);
for (const r of matches) console.log(`  id=${r.id} cat=${r.category} sub=${r.sub_type} tags=${r.tags} name=${r.name?.slice(0, 50)}`);

// 3. 查 sub_type 分布
const subs = await sql`
  SELECT sub_type, COUNT(*) as cnt
  FROM xx_resources
  WHERE status='active' AND sub_type IS NOT NULL AND sub_type != ''
  GROUP BY sub_type
  ORDER BY cnt DESC
  LIMIT 20
`;
console.log('\n=== sub_type 分布 ===');
for (const r of subs) console.log(`  ${r.sub_type}: ${r.cnt}`);

// 4. 查 tags 字段
try {
  const tagSamples = await sql`
    SELECT tags, COUNT(*) as cnt
    FROM xx_resources
    WHERE status='active' AND tags IS NOT NULL AND tags != '' AND tags != 'null'
    GROUP BY tags
    ORDER BY cnt DESC
    LIMIT 20
  `;
  console.log('\n=== tags 分布 (top 20) ===');
  for (const r of tagSamples) console.log(`  ${r.tags}: ${r.cnt}`);
} catch (e) {
  console.log('tags 字段不存在或类型不对:', e.message);
}
