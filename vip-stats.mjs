import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const s = neon(readFileSync('.env.production', 'utf-8').match(/DATABASE_URL=(.+)/)[1].trim());

// 看 xx_vip_links status 分布
const r1 = await s`SELECT status, COUNT(*) as c FROM xx_vip_links GROUP BY status`;
console.log('=== xx_vip_links status 分布 ===');
console.table(r1);

// 看 vip resources + left join 找的 status
const r2 = await s`
  SELECT r.id, r.title, l.status as link_status, l.play_url
  FROM xx_vip_resources r
  LEFT JOIN xx_vip_links l ON l.id = (
    SELECT id FROM xx_vip_links
    WHERE resource_id = r.id AND status = 'ok'
    ORDER BY last_ok_at DESC NULLS LAST, id ASC
    LIMIT 1
  )
  LIMIT 5
`;
console.log('=== 5 个资源 join 状态 ===');
console.table(r2);

// 看 xx_vip_resources 总数
const r3 = await s`SELECT count(*) as total FROM xx_vip_resources`;
console.log('total xx_vip_resources:', r3[0]);

// xx_vip_resources 有没有 hasLink 状态字段
const r4 = await s`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'xx_vip_resources'
  ORDER BY ordinal_position
`;
console.log('xx_vip_resources columns:');
for (const c of r4) console.log(' ', c.column_name);
