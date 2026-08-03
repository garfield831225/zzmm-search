// 看 xx_resources + xx_resource_links 多链接现状
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

// 1. xx_resources 有多 link 的 (1:N)
const r1 = await sql(`SELECT
  r.id, r.name, r.source, r.import_channel,
  COUNT(l.id)::int as link_count
FROM xx_resources r
JOIN xx_resource_links l ON l.resource_id = r.id
WHERE l.status = 'active'
GROUP BY r.id
HAVING COUNT(l.id) >= 2
ORDER BY link_count DESC
LIMIT 10`);
console.log('=== xx_resources 多链接 TOP 10 ===');
console.log(r1);

// 2. 总分布
const r2 = await sql(`SELECT
  CASE WHEN link_count >= 2 THEN 'multi' ELSE 'single' END as type,
  COUNT(*)::int as n
FROM (
  SELECT r.id, COUNT(l.id) as link_count
  FROM xx_resources r
  LEFT JOIN xx_resource_links l ON l.resource_id = r.id AND l.status = 'active'
  GROUP BY r.id
) t
GROUP BY type`);
console.log('=== xx_resources 链接分布 ===');
console.log(r2);

// 3. xx_vip_links 多集数
const r3 = await sql(`SELECT
  resource_id,
  COUNT(*) as n,
  ARRAY_AGG(season || '-' || episode ORDER BY season, episode) as eps
FROM xx_vip_links
GROUP BY resource_id
HAVING COUNT(*) >= 2
ORDER BY n DESC
LIMIT 5`);
console.log('=== xx_vip_links 多集数 TOP 5 ===');
console.log(r3);
