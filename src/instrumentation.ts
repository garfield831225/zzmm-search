// 2026-07-27: NAS Next.js 服务启动钩子
// 用途: Node 24 native fetch 不读 HTTP_PROXY env, 必须显式 setGlobalDispatcher
// 这样所有 API route (/api/admin/match 等) 调 TMDB 都能走 192.168.3.3:7897 代理绕 GFW
// 否则 fetch api.themoviedb.org 被 GFW 挡, 静默返回 ECONNRESET, matcher 全 0 命中

export async function register() {
  // 只在 nodejs runtime 跑 (edge 不需要 - edge 部署 worker 不在这台 NAS)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const httpProxy = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || 'http://192.168.3.3:7897';
  if (!httpProxy) return;

  try {
    const { setGlobalDispatcher, ProxyAgent } = await import('undici');
    setGlobalDispatcher(new ProxyAgent({ uri: httpProxy, connectTimeout: 30000, bodyTimeout: 30000 }));
    console.log('[instrumentation] setGlobalDispatcher(ProxyAgent) ok:', httpProxy);
  } catch (e: any) {
    console.error('[instrumentation] setGlobalDispatcher failed:', e?.message?.slice(0, 200));
  }
}
