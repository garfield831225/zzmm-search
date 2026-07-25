// 看 search API 实际跑什么
import jwt from 'jsonwebtoken';
const token = jwt.sign({ id: 1, group: 'admin', iat: Math.floor(Date.now()/1000) }, 'cLWhs2015', { expiresIn: '7d' });

// 加 source 过滤
const url = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&page=1&pageSize=3&sort=import_time_asc';
const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
const d = await r.json();
console.log('=== 完整响应 (source=magnet) ===');
console.log(JSON.stringify(d).slice(0, 2000));

// 不加 source 过滤
const url2 = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&page=1&pageSize=3&sort=import_time_asc';
const r2 = await fetch(url2, { headers: { Authorization: 'Bearer ' + token } });
const d2 = await r2.json();
console.log('\n=== 完整响应 (no source) ===');
console.log('Total:', d2.total, 'Items:', d2.items?.length);
if (d2.items?.[0]) console.log('  First item source:', d2.items[0].source, 'cat:', d2.items[0].category, 'pay:', d2.items[0].payType, 'access:', d2.items[0].accessLevel, 'ch:', d2.items[0].importChannel);

process.exit(0);
