import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const s = neon(readFileSync('.env.production', 'utf-8').match(/DATABASE_URL=(.+)/)[1].trim());

const r1 = await s`SELECT id, name, source, status FROM xx_resources WHERE id IN (717105, 735212, 717773)`;
console.log('=== 3 条现状 ===');
console.table(r1);

const r2 = await s`
  SELECT source, COUNT(*) as cnt
  FROM xx_resources
  WHERE source IN ('115', 'telegra_ph', 'tianyi')
    AND access_level = 'vip'
    AND status = 'active'
  GROUP BY source
  ORDER BY source
`;
console.log('=== VIP active 资源按 source 分布 ===');
console.log(r2);
