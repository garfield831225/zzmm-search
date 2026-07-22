import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

let url = process.env.DATABASE_URL;
if (!url) {
  // 从 vercel env 读
  const vercelToken = readFileSync('C:/temp_zzmm/vercel-token.txt', 'utf-8').trim();
  const projId = 'prj_Egoe1PHmFjOkb16ds8aTtMnHs4X0';
  const r = await fetch(`https://api.vercel.com/v10/projects/${projId}/env?decrypt=true&target=production`, {
    headers: { 'Authorization': `Bearer ${vercelToken}` }
  });
  const j = await r.json();
  const envs = j.envs || [];
  for (const e of envs) {
    if (e.key === 'DATABASE_URL') {
      url = e.value;
      console.log('From Vercel API, len=' + (url?.length || 0));
      break;
    }
  }
}

if (!url) { console.error('DATABASE_URL not found'); process.exit(1); }

// Vercel API decrypt 出来是 JWE 密文, 真实值在 runtime
// 用 /api/admin/debug-env 拿真值
const debugR = await fetch('https://zzmm-search.cc.cd/api/admin/debug-env?key=zzmm-batch-test&names=DATABASE_URL');
const debugJ = await debugR.json();
if (debugJ.values && debugJ.values.DATABASE_URL) {
  url = debugJ.values.DATABASE_URL;
  console.log('From runtime, len=' + url.length);
}

const sql = neon(url);
try {
  const cols = await sql`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name='xx_resources' ORDER BY ordinal_position`;
  console.log('xx_resources columns:');
  cols.forEach(c => console.log('  ' + c.column_name + ' ' + c.data_type + ' ' + c.is_nullable));

  const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'xx_resources' ORDER BY indexname`;
  console.log('\nIndexes:');
  idx.forEach(i => console.log('  ' + i.indexname));

  const tbls = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'xx_%' ORDER BY table_name`;
  console.log('\nxx_ tables:');
  tbls.forEach(t => console.log('  ' + t.table_name));
} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
}
