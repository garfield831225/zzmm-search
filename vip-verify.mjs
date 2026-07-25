import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const s = neon(readFileSync('.env.production', 'utf-8').match(/DATABASE_URL=(.+)/)[1].trim());

const r = await s`
  SELECT r.id, r.title, l.id as link_id, l.play_url
  FROM xx_vip_resources r
  LEFT JOIN xx_vip_links l ON l.id = (
    SELECT id FROM xx_vip_links
    WHERE resource_id = r.id AND status = 'ok'
    ORDER BY last_ok_at DESC NULLS LAST, id ASC LIMIT 1
  )
  WHERE l.id IS NOT NULL
  ORDER BY r.popularity DESC NULLS LAST LIMIT 5
`;
console.log('=== LEFT JOIN 拿到 link 的前 5 (smart 排序) ===');
console.table(r);

const r2 = await s`
  SELECT
    (SELECT count(*) FROM xx_vip_resources) as total_resources,
    (SELECT count(DISTINCT resource_id) FROM xx_vip_links WHERE status='ok') as resources_with_link,
    (SELECT count(*) FROM xx_vip_links WHERE status='ok') as total_links
`;
console.log('资源 vs 有 link 资源 vs 总 link:');
console.log(r2[0]);
