// 用 jwt.sign 本地签 admin token
import jwt from 'jsonwebtoken';
const token = jwt.sign(
  { id: 1, group: 'admin', iat: Math.floor(Date.now()/1000) },
  'cLWhs2015',
  { expiresIn: '7d' }
);
console.log('token:', token.slice(0, 30) + '...');

// 测 VIP 区 + 磁力
const url = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=5&sort=import_time_asc';
const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
const d = await r.json();
console.log('Total:', d.total);
console.log('Items count:', d.items?.length);
if (d.items) {
  for (const it of d.items.slice(0, 3)) {
    console.log('---');
    console.log('  id:', it.id, 'name:', it.name?.slice(0, 30));
    console.log('  source:', it.source, 'sourceKey:', it.sourceKey, 'cat:', it.category);
    console.log('  links count:', it.links?.length, 'first link source:', it.links?.[0]?.source);
  }
}

// 测 不带 source 参数 (全部)
const url2 = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&page=1&pageSize=2&sort=import_time_asc';
const r2 = await fetch(url2, { headers: { Authorization: 'Bearer ' + token } });
const d2 = await r2.json();
console.log('\n[no source filter] Total:', d2.total);

process.exit(0);
