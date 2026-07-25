// 直接调 search?debug2=1 看实际 count SQL 跑什么
import jwt from 'jsonwebtoken';
const token = jwt.sign({ id: 1, group: 'admin' }, 'cLWhs2015', { expiresIn: '1h' });
const url = 'https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&debug2=1';
const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
const d = await r.json();
console.log('Status:', r.status);
console.log('Response:', JSON.stringify(d, null, 2).slice(0, 3000));
process.exit(0);
