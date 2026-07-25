// 测 VIP 区默认 (不传 source) 看返多少
import jwt from 'jsonwebtoken';
const token = jwt.sign({ id: 1, group: 'admin' }, 'cLWhs2015', { expiresIn: '1h' });
// 用 server 端真实 JWT_SECRET 签
const r = await fetch('https://zzmm-search.cc.cd/api/admin/diag-bearer?key=zzmm-batch-test');
const d = await r.json();
console.log('diag-bearer (user 123123):', d);

// 测 admin 调 search 不传 source
const r2 = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&page=1&pageSize=5&sort=import_time_asc', {
  headers: { Authorization: 'Bearer ' + token }
});
const d2 = await r2.json();
console.log('\n[admin vip no source] total:', d2.total, 'items:', d2.items?.length);
if (d2.items?.[0]) console.log('  first:', d2.items[0].id, d2.items[0].name?.slice(0, 30), 'source:', d2.items[0].source, 'cat:', d2.items[0].category, 'access:', d2.items[0].accessLevel);

process.exit(0);
