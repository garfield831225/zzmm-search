// 测试英文标题匹配
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const r = await sql(`SELECT id, title, original_title, media_type FROM xx_vip_resources WHERE original_title IS NOT NULL AND original_title <> '' ORDER BY id LIMIT 5`);
for (const row of r) {
  console.log(JSON.stringify(row));
}
