// 看匹配入库的 xx_vip_links 实际 play_url
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

// 看最新的 10 条 xingfan link
const r1 = await sql(`SELECT resource_id, play_url, source_url, season, episode, match_confidence FROM xx_vip_links WHERE source='xingfan' ORDER BY id DESC LIMIT 10`);
console.log('=== 最新 10 条 xingfan link ===');
r1.forEach((row) => console.log(JSON.stringify(row)));

// 看还有多少没匹配
const r2 = await sql(`SELECT COUNT(*)::int as n FROM xx_vip_resources WHERE NOT EXISTS (SELECT 1 FROM xx_vip_links WHERE resource_id = xx_vip_resources.id)`);
console.log('剩余未匹配:', r2[0].n);
