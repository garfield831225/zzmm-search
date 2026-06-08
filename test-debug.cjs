const cats = ['电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影'];
const _params = [...cats];
const _cond = [`r.status = 'active'`];
const ph = cats.map((_, i) => `$${_params.length - cats.length + i + 1}`).join(',');
_cond.push(`r.category IN (${ph})`);
if (cats.length) _params.push(...cats);  // 重复了！_params 已经有 cats
console.log('params:', _params);
console.log('cond:', _cond.join(' AND '));
