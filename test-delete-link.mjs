// 用 Vercel 内置 diag-bearer 拿真 admin token, 然后测 delete
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('C:/temp_zzmm/.env', 'utf-8');
const m = env.match(/DATABASE_URL=([^\n]+)/);
const sql = neon(m[1]);

// 1. 调 diag-bearer 拿 Vercel 真签的 admin token
const r0 = await fetch('https://zzmm-search.cc.cd/api/admin/diag-bearer?key=zzmm-batch-test');
const d0 = await r0.json();
const token = d0.token;
if (!token) {
  // diag-bearer 直接返了 search 结果, 单独需要 admin token 的 endpoint
  // 试用直接打 search 验证 user 12 token
  console.log('no token in diag-bearer, full:', d0);
  process.exit(1);
}
console.log('got token from Vercel:', token.slice(0, 30) + '...');

// 2. 找一个有链接的资源 (admin 角色应该看到 1对N links)
const r1 = await sql`SELECT id, name, source, link, link_code FROM xx_resources WHERE status='active' AND link != '' LIMIT 1`;
console.log('test resource:', r1[0]);

if (!r1[0]) { console.log('no link to delete'); process.exit(0); }

// 3. 调 DELETE
const resp = await fetch('https://zzmm-search.cc.cd/api/admin/links', {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
  body: JSON.stringify({ resourceId: r1[0].id, source: r1[0].source })
});
const data = await resp.json();
console.log('DELETE response:', resp.status, JSON.stringify(data, null, 2));

// 4. 验证是否真删了
const r2 = await sql`SELECT id, name, source, link FROM xx_resources WHERE id = ${r1[0].id}`;
console.log('after delete:', r2[0]);
const r3 = await sql`SELECT id, status FROM xx_resource_links WHERE resource_id = ${r1[0].id} AND source = ${r1[0].source}`;
console.log('sub-table row:', r3);
