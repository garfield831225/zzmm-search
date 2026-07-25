// 看 xx_vip_links 状态
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

// 1. xx_vip_links 总数 + 按 URL 模式分组
const r1 = await sql(`SELECT
  CASE
    WHEN play_url LIKE 'https://php.playerla.com/%' THEN 'playerla'
    WHEN play_url LIKE '%xingfan.cc%' THEN 'xingfan'
    ELSE 'other'
  END AS url_type,
  COUNT(*)::int as n
FROM xx_vip_links
GROUP BY url_type
ORDER BY n DESC`);
console.log('=== xx_vip_links 按 URL 类型 ===');
console.log(r1);

// 2. 资源状态: 有链接的 / 还没匹配的
const r2 = await sql(`SELECT
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM xx_vip_links l WHERE l.resource_id = r.id))::int as with_link,
  COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM xx_vip_links l WHERE l.resource_id = r.id))::int as no_link,
  COUNT(*)::int as total
FROM xx_vip_resources r`);
console.log('=== 资源状态 ===');
console.log(r2);

// 3. 后台批处理进度（如果还在跑） - 看最新入库时间
const r3 = await sql(`SELECT source, MAX(id) as last_id, MAX(last_check_at) as last_check FROM xx_vip_links GROUP BY source`);
console.log('=== 各 source 最新 ===');
console.log(r3);
