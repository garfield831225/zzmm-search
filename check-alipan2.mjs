// 细查 aliyun 数据的 import_channel
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

console.log('=== aliyun 数据的 import_channel 分布 ===');
const dist = await sql(`SELECT import_channel, COUNT(*)::int as n FROM xx_resources WHERE source='aliyun' GROUP BY import_channel ORDER BY n DESC`);
console.log(dist);

console.log('\n=== aliyun 数据 12h 内按 import_channel ===');
const dist2 = await sql(`SELECT import_channel, COUNT(*)::int as n, MIN(created_at) as first, MAX(created_at) as last FROM xx_resources WHERE source='aliyun' AND created_at > NOW() - INTERVAL '12 hours' GROUP BY import_channel ORDER BY n DESC`);
console.log(dist2);

console.log('\n=== 看 import_classify 逻辑端点 ===');
// 找分类端点
console.log('=== 看下前端 catalog 用的 import_channel 枚举 ===');
const col = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='xx_resources' ORDER BY ordinal_position`);
console.log(col);

console.log('\n=== xx_resources 全部 distinct import_channel ===');
const ic = await sql(`SELECT import_channel, source, COUNT(*)::int as n FROM xx_resources GROUP BY import_channel, source ORDER BY n DESC LIMIT 30`);
console.log(ic);
