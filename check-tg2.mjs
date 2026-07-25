// 看 import_channel 全部 distinct
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const r = await sql(`SELECT DISTINCT import_channel FROM xx_resources ORDER BY import_channel`);
console.log('全部 import_channel:');
r.forEach(x => console.log(' ', x.import_channel));
