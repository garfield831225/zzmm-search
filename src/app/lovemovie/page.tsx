// 2026-08-08: VIP 影视 2 区 (镜像站 iframe 嵌入)
// 之前 CF tunnel 配 lovemovie.zzmm-search.uk -> 外部镜像站, 被覆盖 PUT 删了
// 现在用 iframe 嵌入外部 URL, URL 在 .env.NEXT_PUBLIC_LOVEMOVIE_URL 里 (空时显示"建设中"提示)
'use client';
import { useState, useEffect } from 'react';

export default function LoveMoviePage() {
  const url = process.env.NEXT_PUBLIC_LOVEMOVIE_URL || '';
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!url) setError('镜像站 URL 未配置, 请联系站长');
  }, [url]);

  if (!url) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
        <div className="max-w-md w-full text-center">
          <div className="text-6xl mb-4">🎬</div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 via-fuchsia-400 to-pink-400 bg-clip-text text-transparent mb-3">
            VIP 影视 2 区
          </h1>
          <p className="text-white/60 mb-2">镜像站建设中</p>
          {error && <p className="text-amber-400 text-sm mb-4">⚠️ {error}</p>}
          <a href="/" className="inline-block px-4 py-2 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/60 hover:text-white">
            ← 返回首页
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* 顶部 bar (方便回首页) */}
      <div className="bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-sm text-white/60">
          <span className="text-violet-400">🎬</span>
          <span>VIP 影视 2 区 (镜像站)</span>
        </div>
        <div className="flex items-center gap-2">
          <a href={url} target="_blank" rel="noopener" className="text-xs text-white/40 hover:text-white/60">
            🔗 新窗口打开
          </a>
          <a href="/" className="text-xs text-white/40 hover:text-white/60">
            ← 首页
          </a>
        </div>
      </div>
      {/* iframe 嵌入 */}
      <div className="flex-1 relative">
        {!iframeLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0f] z-10">
            <div className="text-center">
              <div className="inline-block w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin mb-2"></div>
              <p className="text-white/60 text-sm">加载镜像站...</p>
            </div>
          </div>
        )}
        <iframe
          src={url}
          className="w-full h-full border-0"
          onLoad={() => setIframeLoaded(true)}
          onError={() => setError('镜像站加载失败')}
          allow="autoplay; encrypted-media; fullscreen"
          allowFullScreen
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  );
}
