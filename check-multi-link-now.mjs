import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('.env.production', 'utf-8');
const m = env.match(/DATABASE_URL=(.+)/);
const s = neon(m[1].trim());

const r1 = await s`SELECT count(*) as total,
  count(CASE WHEN is_multi_link=true THEN 1 END) as multi,
  count(CASE WHEN is_multi_link=false THEN 1 END) as single
  FROM xx_resources`;
console.log('xx_resources:', r1[0]);

const r2 = await s`SELECT count(*) as link_total,
  count(DISTINCT resource_id) as distinct_resources
  FROM xx_resource_links WHERE status='active'`;
console.log('xx_resource_links:', r2[0]);

const r3 = await s`SELECT source, count(*) as c
  FROM xx_resource_links WHERE status='active'
  GROUP BY source ORDER BY c DESC`;
console.log('by source:');
for (const x of r3) console.log('  ', x.source, x.c);

const r4 = await s`SELECT count(*) as mismatch
  FROM xx_resources r
  WHERE r.is_multi_link=false
    AND EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id=r.id AND l.status='active')`;
console.log('mismatch (is_multi_link=false 但有 links):', r4[0].mismatch);

const r5 = await s`SELECT count(*) as no_link
  FROM xx_resources r
  WHERE NOT EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id=r.id AND l.status='active')`;
console.log('no links:', r5[0].no_link);
