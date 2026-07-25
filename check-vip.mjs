// 检查 /vip 数据状态
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const r1 = await sql('SELECT COUNT(*)::int as n FROM xx_vip_resources');
const r2 = await sql('SELECT COUNT(*)::int as n FROM xx_vip_links');
const r3 = await sql(`SELECT status, COUNT(*)::int as n FROM xx_vip_links GROUP BY status`);
const r4 = await sql(`SELECT source, COUNT(*)::int as n FROM xx_vip_links GROUP BY source`);
const r5 = await sql(`SELECT media_type, COUNT(*)::int as n FROM xx_vip_resources GROUP BY media_type`);
console.log('xx_vip_resources 总:', r1[0].n, '按 type:', r5);
console.log('xx_vip_links 总:', r2[0].n, '按 status:', r3, '按 source:', r4);
