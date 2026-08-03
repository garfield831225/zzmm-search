// 用 zezhe 用户试 (id=8 basic)
import jwt from 'jsonwebtoken';

async function test(label, payload) {
  const token = jwt.sign(payload, 'cLWhs2015', { expiresIn: '7d' });
  const url = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  const d = await r.json();
  console.log(`[${label}] total=${d.total} items=${d.items?.length} firstId=${d.items?.[0]?.id} firstSource=${d.items?.[0]?.source} firstCat=${d.items?.[0]?.category} err=${d.error?.slice(0,80)}`);
}

await test('id=1 admin', { id: 1, group: 'admin' });
await test('id=2 member', { id: 2, group: 'member' });
await test('id=8 basic', { id: 8, group: 'basic' });
await test('id=9999 user', { id: 9999, group: 'user' });

// 测 cookie 鉴权 (zzmm_token)
const r = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc', {
  headers: { Cookie: 'zzmm_token=' + jwt.sign({ id: 1, group: 'admin' }, 'cLWhs2015', { expiresIn: '7d' }) },
});
const d = await r.json();
console.log(`[cookie] total=${d.total} items=${d.items?.length}`);

process.exit(0);
