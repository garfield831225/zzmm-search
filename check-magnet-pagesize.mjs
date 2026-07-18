// 看 search API 默认 pageSize + sort + 各种 zone
import jwt from 'jsonwebtoken';
const token = jwt.sign({ id: 1, group: 'admin', iat: Math.floor(Date.now()/1000) }, 'cLWhs2015', { expiresIn: '7d' });

// 用 vip 用户的角度 (id=2, member)
const token2 = jwt.sign({ id: 2, group: 'member', iat: Math.floor(Date.now()/1000) }, 'cLWhs2015', { expiresIn: '7d' });

async function test(label, url, t) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t } });
  const d = await r.json();
  console.log(`[${label}] total=${d.total} items=${d.items?.length} firstSource=${d.items?.[0]?.source}`);
}

await test('vip magnet default', 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=50&sort=import_time_asc', token);
await test('vip magnet admin', 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=50&sort=import_time_asc', token2);
await test('vip no-filter admin', 'https://zzmm-search.cc.cd/api/search?zone=library_vip&page=1&pageSize=5&sort=import_time_asc', token);
await test('zezhe magnet', 'https://zzmm-search.cc.cd/api/search?zone=library_zezhe&source=magnet&page=1&pageSize=5&sort=import_time_asc', token);
await test('vip source=115', 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=115&page=1&pageSize=5&sort=import_time_asc', token);

process.exit(0);
