'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

// 2026-07-15: 非影视区主页重做 - 只显示 6 个分类入口卡
// 资源列表移到 4 个子页 (/nonfilm/sports /ebooks /courses /textbooks)
// /nonfilm/music 用独立页, /games 走独立 VIP 页

const SECTIONS: { key: string; icon: string; label: string; desc: string; href: string; badge?: string; color: string }[] = [
  { key: 'games', icon: '🎮', label: '游戏中心', desc: '掌机/PC 6万+', href: '/games', badge: 'VIP', color: 'from-amber-500 to-orange-600' },
  { key: 'music', icon: '🎵', label: '音乐', desc: 'Hi-Res 专辑', href: '/nonfilm/music', color: 'from-pink-500 to-rose-600' },
  { key: 'sports', icon: '⚽', label: '体育', desc: '赛事/纪录片', href: '/nonfilm/sports', color: 'from-green-500 to-emerald-600' },
  { key: 'ebooks', icon: '📚', label: '电子书', desc: '小说/教程', href: '/nonfilm/ebooks', badge: 'VIP', color: 'from-blue-500 to-cyan-600' },
  { key: 'courses', icon: '🎓', label: '精品课', desc: '付费课/讲座', href: '/nonfilm/courses', badge: 'VIP', color: 'from-violet-500 to-purple-600' },
  { key: 'textbooks', icon: '📖', label: '教辅', desc: '教程/工具', href: '/nonfilm/textbooks', badge: 'VIP', color: 'from-slate-500 to-gray-600' },
];

export default function NonFilmHomePage() {
  // 简单查各分类的资源数 (用于显示统计)
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    const cats = ['音乐', '体育', '电子书', '精品课', '文档'];
    Promise.all(cats.map(async (cat) => {
      try {
        const r = await fetch(`/api/search?category=${encodeURIComponent(cat)}&zone=nonfilm&pageSize=1`);
        const d = await r.json();
        return [cat, d.total || 0];
      } catch { return [cat, 0]; }
    })).then(arr => setCounts(Object.fromEntries(arr)));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 text-gray-900">
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/" className="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-500 rounded-xl flex items-center justify-center">
                <span className="text-xl">🎵</span>
              </Link>
              <div>
                <h1 className="text-xl font-bold text-gray-900">非影视区</h1>
                <p className="text-xs text-gray-500">音乐 / 体育 / 文档等资源</p>
              </div>
            </div>
            <Link href="/" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm transition">
              ← 影视区
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* 6 个分类入口卡 */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {SECTIONS.map((s, i) => (
            <motion.div
              key={s.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Link
                href={s.href}
                className={`group block relative overflow-hidden rounded-2xl p-6 bg-gradient-to-br ${s.color} text-white shadow-md hover:shadow-xl transition-all hover:scale-[1.02]`}
              >
                <div className="text-5xl mb-3">{s.icon}</div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold">{s.label}</h2>
                  {s.badge && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-white/30 rounded font-medium">{s.badge}</span>
                  )}
                </div>
                <p className="text-sm text-white/80 mt-1">{s.desc}</p>
                {s.key !== 'games' && s.key !== 'music' && counts[s.key === 'textbooks' ? '文档' : s.label] !== undefined && (
                  <p className="text-xs text-white/60 mt-2">{(counts[s.key === 'textbooks' ? '文档' : s.label] || 0).toLocaleString()} 条资源</p>
                )}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition text-2xl">→</div>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="mt-8 p-4 bg-cyan-50 border border-cyan-200 rounded-xl text-sm text-cyan-800">
          <p className="font-medium mb-1">💡 提示</p>
          <p>每个分类下都有 pageMode 切换 (加载更多/真分页) + cover_first 排序 + 格式标签筛选</p>
        </div>
      </main>
    </div>
  );
}
