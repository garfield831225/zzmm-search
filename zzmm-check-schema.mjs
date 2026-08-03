// 查 xx_resource_links schema + 索引
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const cols = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'xx_resource_links' ORDER BY ordinal_position`;
console.log('=== xx_resource_links 字段 ===');
console.log(JSON.stringify(cols, null, 2));
const idx = await sql`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'xx_resource_links'`;
console.log('\n=== 索引 ===');
console.log(JSON.stringify(idx, null, 2));
