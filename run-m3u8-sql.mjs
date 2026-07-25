// 跑 SQL
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const raw = fs.readFileSync('sql/2026-07-24-vip-m3u8.sql', 'utf-8');
const stmts = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
for (const s of stmts) {
  console.log('>>>', s.slice(0, 100).replace(/\n/g, ' '));
  try { await sql(s); console.log('   ok'); } catch (e) { console.log('   ERR:', e.message.slice(0, 200)); }
}
const r = await sql(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='xx_vip_links' AND column_name LIKE 'm3u8%'`);
console.log('=== 新增字段 ==='); console.log(r);
