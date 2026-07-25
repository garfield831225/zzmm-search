// 验证 section='tg' 过滤
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

const r1 = await sql(`SELECT COUNT(*)::int as n FROM xx_resources WHERE status='active' AND import_channel LIKE 'tg\\\\_%' ESCAPE '\\'`);
console.log('section=tg (escape) count:', r1[0].n);

const r2 = await sql(`SELECT COUNT(*)::int as n FROM xx_resources WHERE status='active' AND import_channel LIKE 'tg%'`);
console.log('section=tg (no escape) count:', r2[0].n);

const r3 = await sql(`SELECT import_channel, COUNT(*)::int as n FROM xx_resources WHERE import_channel LIKE 'tg%' GROUP BY import_channel ORDER BY n DESC LIMIT 15`);
console.log('tg 分布:', r3);

const r4 = await sql(`SELECT id, name, import_channel, source FROM xx_resources WHERE import_channel='tg_aliyun' ORDER BY id LIMIT 3`);
console.log('tg_aliyun 样本:', r4);
