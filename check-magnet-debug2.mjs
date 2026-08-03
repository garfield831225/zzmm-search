import jwt from 'jsonwebtoken';
const token = jwt.sign({ id: 1, group: 'admin', iat: Math.floor(Date.now()/1000) }, 'cLWhs2015', { expiresIn: '7d' });
console.log('Token:', token);

const r = await fetch('https://zzmm-search.cc.cd/api/search?zone=library_vip&source=magnet&debug=1&page=1&pageSize=3&sort=import_time_asc', {
  headers: { Authorization: 'Bearer ' + token },
});
const d = await r.json();
console.log('Response:', JSON.stringify(d, null, 2).slice(0, 3000));

process.exit(0);
