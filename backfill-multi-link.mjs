// 2026-07-24: 回填 xx_resources.is_multi_link = true
// 当 xx_resource_links 有 active 链接但资源 is_multi_link=false 时
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.production', 'utf-8');
const s = neon(env.match(/DATABASE_URL=(.+)/)[1].trim());

console.log('📊 修前统计...');
const before = await s`SELECT
  count(*) as total,
  count(CASE WHEN is_multi_link=true THEN 1 END) as multi,
  count(CASE WHEN is_multi_link=false THEN 1 END) as single
  FROM xx_resources`;
console.log(before[0]);

console.log('\n🔧 回填: is_multi_link=false 但有 links → true');
const upd = await s`UPDATE xx_resources r
  SET is_multi_link = true,
      updated_at = NOW()
  WHERE r.is_multi_link = false
    AND EXISTS (
      SELECT 1 FROM xx_resource_links l
      WHERE l.resource_id = r.id AND l.status = 'active'
    )
  RETURNING id`;
console.log(`✅ 更新 ${upd.length} 条`);

console.log('\n📊 修后统计...');
const after = await s`SELECT
  count(*) as total,
  count(CASE WHEN is_multi_link=true THEN 1 END) as multi,
  count(CASE WHEN is_multi_link=false THEN 1 END) as single
  FROM xx_resources`;
console.log(after[0]);

const mismatch2 = await s`SELECT count(*) as c
  FROM xx_resources r
  WHERE r.is_multi_link = false
    AND EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id = r.id AND l.status = 'active')`;
console.log('剩余 mismatch:', mismatch2[0].c);
