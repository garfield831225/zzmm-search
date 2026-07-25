// 跑回填 SQL
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

const raw = fs.readFileSync('sql/backfill-tg-channel.sql', 'utf-8');
// 拆成语句 (按分号, 去掉注释)
const statements = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

for (const stmt of statements) {
  console.log('\n>>>', stmt.slice(0, 80).replace(/\n/g, ' ') + (stmt.length > 80 ? '...' : ''));
  try {
    const result = await sql(stmt);
    if (Array.isArray(result)) {
      console.log('    rows:', result.length);
      if (result.length > 0 && result.length < 30) {
        console.log(JSON.stringify(result, null, 2));
      }
    } else {
      console.log('    done');
    }
  } catch (e) {
    console.log('    ERR:', e.message.slice(0, 200));
  }
}
