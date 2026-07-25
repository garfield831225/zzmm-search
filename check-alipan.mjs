// 查阿里云盘 TG 入库情况
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

console.log('=== xx_resources 总数 + 阿里云盘分布 ===');
const total = await sql('SELECT COUNT(*)::int as n FROM xx_resources');
console.log('总资源:', total[0].n);

const alipan = await sql(`SELECT source, COUNT(*)::int as n FROM xx_resources WHERE source ILIKE '%ali%' OR source ILIKE '%aliyun%' OR name ILIKE '%aliyun%' OR link ILIKE '%aliyun%' OR link ILIKE '%alipan%' GROUP BY source ORDER BY n DESC LIMIT 20`);
console.log('ali 相关 source 分布:', alipan);

console.log('\n=== 今日入库 (按 source) ===');
const today = await sql(`SELECT source, COUNT(*)::int as n, MAX(created_at) as last FROM xx_resources WHERE created_at > NOW() - INTERVAL '12 hours' GROUP BY source ORDER BY n DESC LIMIT 20`);
console.log('12h 内:', today);

console.log('\n=== import_channel 分布 (新字段) ===');
try {
  const ic = await sql(`SELECT import_channel, COUNT(*)::int as n FROM xx_resources GROUP BY import_channel ORDER BY n DESC`);
  console.log(ic);
} catch (e) {
  console.log('  import_channel 字段不存在:', e.message.slice(0, 100));
}

console.log('\n=== 看 source 字段类型 (前 30 个 distinct) ===');
const srcs = await sql('SELECT DISTINCT source FROM xx_resources ORDER BY source LIMIT 30');
console.log(srcs.map(s => s.source));

console.log('\n=== 看 link 字段含 alipan 的样本 ===');
const samples = await sql(`SELECT id, name, source, link, created_at FROM xx_resources WHERE link ILIKE '%alipan%' OR link ILIKE '%aliyun%' ORDER BY created_at DESC LIMIT 5`);
console.log(samples);
