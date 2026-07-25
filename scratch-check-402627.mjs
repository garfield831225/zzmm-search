// 看 resource_id 402627 是什么
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

const r = await sql`SELECT id, source, link, name, category, import_channel FROM xx_resources WHERE id IN (402627, 542863)`;
console.log(JSON.stringify(r, null, 2));

// 看 baidu url 真的不含 dmhy 吗
const r2 = await sql`SELECT id, url, source, resource_id FROM xx_resource_links WHERE resource_id = 402627`;
console.log('402627 全部副表:');
console.log(JSON.stringify(r2, null, 2));

// 542863 全部副表
const r3 = await sql`SELECT id, url, source, resource_id, sort FROM xx_resource_links WHERE resource_id = 542863 ORDER BY sort`;
console.log('542863 全部副表:');
console.log(JSON.stringify(r3, null, 2));

process.exit(0);
