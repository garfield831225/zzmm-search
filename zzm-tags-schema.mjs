// 看 tags 字段实际类型 + malformed 原因
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];
const sql = neon(process.env.DATABASE_URL);

const schema = await sql`
  SELECT column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_name='xx_resources' AND column_name='tags'
`;
console.log('tags schema:', schema[0]);

// 找 5 个含 "短剧" 的样本 (text array 安全)
const samples = await sql`
  SELECT id, name, tags
  FROM xx_resources
  WHERE status='active' AND array_to_string(tags, ',') LIKE '%短剧%'
  LIMIT 5
`;
console.log('\n=== 含短剧的 tags 样本 ===');
for (const s of samples) {
  console.log(`id=${s.id}`);
  console.log(`  name: ${s.name?.slice(0, 50)}`);
  console.log(`  tags type: ${typeof s.tags} | isArray: ${Array.isArray(s.tags)} | value: ${JSON.stringify(s.tags)?.slice(0, 200)}`);
}

// 查 tags 里出现 "短剧" 的所有不同值
const uniq = await sql`
  SELECT DISTINCT unnest(tags) as tag, COUNT(*) as cnt
  FROM xx_resources
  WHERE status='active'
  GROUP BY tag
  HAVING tag LIKE '%短剧%'
  ORDER BY cnt DESC
`;
console.log('\n=== 含 "短剧" 的不同 tag 值 ===');
for (const u of uniq) console.log(`  ${u.tag}: ${u.cnt}`);

// 总量: 含短剧标签的资源
const cnt = await sql`
  SELECT COUNT(*)::int as cnt
  FROM xx_resources
  WHERE status='active' AND array_to_string(tags, ',') LIKE '%短剧%'
`;
console.log(`\n含短剧标签的资源总数: ${cnt[0]?.cnt}`);
