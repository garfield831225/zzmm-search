// 看剩下 2 个 xingfan
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const r = await sql(`SELECT id, play_url, source_url, season, episode, last_check_at FROM xx_vip_links WHERE play_url LIKE '%xingfan.cc%' ORDER BY id`);
console.log('=== 剩余 xingfan URL ===');
console.log(r);
