import { neon } from '@neondatabase/serverless';

const DB = 'postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require';
const sql = neon(DB);

const r1 = await sql`SELECT COUNT(*)::int as total, media_type FROM xx_vip_resources GROUP BY media_type`;
console.log('xx_vip_resources:');
r1.forEach(x => console.log('  ', x.media_type, '→', x.total));

const r2 = await sql`SELECT
  (SELECT COUNT(*)::int FROM xx_vip_links WHERE status='ok') as ok_links,
  (SELECT COUNT(*)::int FROM xx_vip_links) as total_links`;
console.log('xx_vip_links:', r2[0]);
process.exit(0);
