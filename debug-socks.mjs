// 简化：直接用 https-proxy-agent 作为 fetch 的 dispatcher
import { HttpsProxyAgent } from 'https-proxy-agent';
import { fetch as undiciFetch, Agent } from 'undici';

const proxyUrl = 'http://127.0.0.1:7897';
const dispatcher = new Agent({
  connect: { proxy: { uri: proxyUrl } },
  connectTimeout: 30000,
});

const url = 'https://api.themoviedb.org/3/configuration?api_key=7985342d5961e9ee3d5ef6d969c1b8dd';

try {
  console.log('Direct...');
  const r = await undiciFetch(url, { signal: AbortSignal.timeout(30000) });
  console.log('Status:', r.status);
  const t = await r.text();
  console.log('Length:', t.length);
} catch (e) {
  console.log('Direct err:', e.message, e.cause?.code);
}

try {
  console.log('\nWith proxy...');
  const r = await undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(30000) });
  console.log('Status:', r.status);
  const t = await r.text();
  console.log('Length:', t.length);
} catch (e) {
  console.log('Proxy err:', e.message, e.cause?.code);
}
