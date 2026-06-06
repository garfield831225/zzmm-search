// 详细 debug
import { lookup } from 'node:dns/promises';

const url = 'https://api.themoviedb.org/3/trending/movie/week';
console.log('=== DNS lookup ===');
try {
  const addrs = await lookup('api.themoviedb.org', { all: true, family: 0 });
  for (const a of addrs) console.log(`  ${a.family}: ${a.address}`);
} catch (e) { console.log('DNS err:', e.message); }

console.log('\n=== Direct fetch (no proxy) ===');
try {
  const r = await fetch(url + '?api_key=7985342d5961e9ee3d5ef6d969c1b8dd&language=zh-CN', {
    signal: AbortSignal.timeout(20000),
  });
  console.log('Status:', r.status);
  const t = await r.text();
  console.log('Length:', t.length);
} catch (e) {
  console.log('Err:', e.message);
  console.log('Cause:', e.cause);
}

console.log('\n=== With system proxy env ===');
process.env.HTTP_PROXY = 'http://127.0.0.1:7897';
process.env.HTTPS_PROXY = 'http://127.0.0.1:7897';
try {
  const r = await fetch(url + '?api_key=7985342d5961e9ee3d5ef6d969c1b8dd&language=zh-CN', {
    signal: AbortSignal.timeout(20000),
  });
  console.log('Status:', r.status);
} catch (e) {
  console.log('Err:', e.message);
  console.log('Cause:', e.cause?.code, e.cause?.message);
}
