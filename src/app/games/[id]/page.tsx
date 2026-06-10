'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

interface Game {
  id: number;
  name: string;
  platform: string;
  sub_platform: string | null;
  cover_url: string | null;
  description: string | null;
  link: string;
  link_code: string | null;
  size: string | null;
  source: string | null;
  release_date: string | null;
  publisher: string | null;
  developer: string | null;
  language: string | null;
  match_status: string;
  is_vip_only: boolean;
  view_count: number;
  created_at: string;
}

export default function GameDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ id: number; msg: string; type: 'success' | 'error' } | null>(null);
  let toastCounter = 0;

  const addToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    const id = ++toastCounter;
    setToast({ id, msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`/api/games/${params.id}`, { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) {
          if (d.need === 'vip') addToast(d.tip || '需要 VIP', 'error');
          else addToast(d.error || '加载失败', 'error');
          setGame(null);
        } else {
          setGame(d.game);
        }
      })
      .catch(() => addToast('网络错误', 'error'))
      .finally(() => setLoading(false));
  }, [params?.id, addToast]);

  const handleCopy = useCallback(async () => {
    if (!game) return;
    const fullLink = game.link_code
      ? `${game.link} 提取码: ${game.link_code}`
      : game.link;
    try {
      await navigator.clipboard.writeText(fullLink);
      addToast('已复制到剪贴板', 'success');
    } catch {
      addToast('复制失败', 'error');
    }
  }, [game, addToast]);

  const handleOpen = useCallback(() => {
    if (!game) return;
    if (game.link.startsWith('magnet:') || game.link.startsWith('ed2k://')) {
      window.location.href = game.link;
    } else {
      window.open(game.link, '_blank');
    }
  }, [game]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">
        加载中...
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl mb-4">🎮</div>
          <p className="text-slate-400 mb-4">游戏不存在或您没有权限查看</p>
          <Link href="/games" className="text-amber-400 hover:underline">
            ← 返回游戏中心
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-400 hover:text-white mb-4"
        >
          ← 返回
        </button>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* 封面 */}
          <div className="md:col-span-1">
            <div className="aspect-[3/4] bg-slate-900 rounded-2xl overflow-hidden border border-slate-800">
              {game.cover_url ? (
                <img src={game.cover_url} alt={game.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl bg-gradient-to-br from-slate-800 to-slate-900">
                  🎮
                </div>
              )}
            </div>
          </div>

          {/* 信息 */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
                {game.platform}
              </span>
              {game.sub_platform && (
                <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400">
                  {game.sub_platform}
                </span>
              )}
              {game.is_vip_only && (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  👑 VIP 专属
                </span>
              )}
              {game.language && (
                <span className="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-400">
                  🌐 {game.language}
                </span>
              )}
            </div>

            <h1 className="text-3xl font-bold mb-4">{game.name}</h1>

            {game.description && (
              <p className="text-slate-300 mb-6 leading-relaxed whitespace-pre-line">
                {game.description}
              </p>
            )}

            {/* 元数据 */}
            <div className="grid grid-cols-2 gap-3 mb-6 text-sm">
              {game.size && (
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs mb-1">大小</div>
                  <div className="text-slate-200">💾 {game.size}</div>
                </div>
              )}
              {game.source && (
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs mb-1">来源</div>
                  <div className="text-slate-200">📡 {game.source}</div>
                </div>
              )}
              {game.release_date && (
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs mb-1">发售日</div>
                  <div className="text-slate-200">📅 {game.release_date}</div>
                </div>
              )}
              {game.developer && (
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs mb-1">开发商</div>
                  <div className="text-slate-200">🏢 {game.developer}</div>
                </div>
              )}
              {game.publisher && (
                <div className="bg-slate-900/50 rounded-lg p-3">
                  <div className="text-slate-500 text-xs mb-1">发行商</div>
                  <div className="text-slate-200">📢 {game.publisher}</div>
                </div>
              )}
              <div className="bg-slate-900/50 rounded-lg p-3">
                <div className="text-slate-500 text-xs mb-1">浏览数</div>
                <div className="text-slate-200">👁️ {game.view_count}</div>
              </div>
            </div>

            {/* 下载区 */}
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/30 rounded-2xl p-5">
              <div className="text-sm text-amber-400 mb-2">📥 下载资源</div>
              <div className="text-xs text-slate-400 mb-4 font-mono break-all">
                {game.link}
                {game.link_code && (
                  <span className="text-amber-400 ml-2">
                    提取码: {game.link_code}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="flex-1 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-900 font-medium rounded-lg text-sm"
                >
                  📋 复制链接
                </button>
                <button
                  onClick={handleOpen}
                  className="flex-1 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg text-sm border border-slate-700"
                >
                  🔗 打开链接
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className={`fixed bottom-6 right-6 px-5 py-3 rounded-lg shadow-2xl z-50 ${
            toast.type === 'error' ? 'bg-red-500/90' : 'bg-amber-500/90 text-slate-900'
          }`}
        >
          {toast.msg}
        </motion.div>
      )}
    </div>
  );
}
