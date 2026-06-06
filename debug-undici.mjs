// 测试 undici ProxyAgent
import { Agent, fetch as undiciFetch } from 'undici';

const proxyUrl = 'http://127.0.0.1:7897';
const dispatcher = new Agent({
  connect: { proxy: { uri: proxyUrl } },
  connectTimeout: 20000,
});

const url = 'https://api.themoviedb.org/3/trending/movie/week?api_key=7985342d5961e9ee3d5ef6d969c1b8dd&language=zh-CN';
console.log('=== With ProxyAgent ===');
try {
  const r = await undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(20000) });
  console.log('Status:', r.status);
  const t = await r.text();
  console.log('Length:', t.length);
  console.log('First 100:', t.slice(0, 100));
} catch (e) {
  console.log('Err:', e.message);
  console.log('Cause:', e.cause);
}
