'use client';
// 2026-08-05: global error boundary
//   - 用户报 Safari 详情页 client-side exception → 整页白屏 "Application error"
//   - Next.js 14 production 默认 catch 是 __next_error__ 兜底
//   - 加这个后所有未捕获 error 显示降级 UI + 错误详情, 不白屏
//   - 同时支持 reload / 返回首页 / 联系 admin

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body className="antialiased bg-[#0a0a0f] text-white min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-[#12121a] rounded-2xl border border-red-500/20 p-6 text-center shadow-2xl">
          <div className="text-5xl mb-3">⚠️</div>
          <h1 className="text-xl font-bold mb-2 text-red-300">页面加载出错</h1>
          <p className="text-sm text-white/60 mb-4 leading-relaxed">
            抱歉，页面遇到异常。可能是浏览器兼容性问题。
            <br />
            请尝试刷新页面或返回首页。
          </p>
          {error.digest && (
            <div className="text-[10px] text-white/30 font-mono mb-4 break-all">
              错误 ID: {error.digest}
            </div>
          )}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={() => reset()}
              className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded-lg text-sm font-medium transition"
            >
              🔄 重新加载
            </button>
            <a
              href="/"
              className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition"
            >
              🏠 返回首页
            </a>
          </div>
          <details className="mt-4 text-left">
            <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60">
              查看技术详情
            </summary>
            <pre className="mt-2 text-[10px] text-white/30 bg-black/30 rounded p-2 overflow-auto max-h-32 font-mono break-all whitespace-pre-wrap">
              {error.message || '(无错误消息)'}
            </pre>
          </details>
        </div>
      </body>
    </html>
  );
}
