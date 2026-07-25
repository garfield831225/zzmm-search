'use client';

// 2026-07-25: 去掉 framer-motion (SSR hydration 冲突导致整个 client tree 崩)
// 改用 CSS transition + 普通 a, 兼容 SSR

import { useEffect, useState } from 'react';

interface ChannelStat {
  channel: string;
  count: number;
  last_import: string;
}

const HUBS = [
  {
    key: 'tg-json',
    title: 'TG 频道 JSON',
    icon: '📡',
    color: 'from-cyan-500/20 to-blue-500/20 border-cyan-500/40',
    badge: '推荐',
    desc: 'TG Desktop 导出的 result.json (含多网盘多链接)',
    features: [
      '✅ 一个 message 含多个网盘链接自动合并',
      '✅ 主链接 (115 优先) + 副链接 (xx_resource_links)',
      '✅ telegra.ph 中间页入 L2/L3 队列',
      '✅ 自动识别 11 个网盘 (aliyun/quark/baidu/115/123/UC/天翼/移动/迅雷/磁力/ed2k)',
    ],
    bestFor: '1 资源 + N 链接 (如 1 部电影 115+阿里+夸克 都有)',
    href: '/admin/import-tg',
  },
  {
    key: 'zzmm-excel',
    title: '泽泽妈妈 Excel',
    icon: '👑',
    color: 'from-pink-500/20 to-purple-500/20 border-pink-500/40',
    desc: '21-sheet 文档批量入库, 增量同步支持',
    features: [
      '✅ 多 sheet 自动识别 21 个分类',
      '✅ 增量同步 (二次导入自动软删差异)',
      '✅ 合并 原盘资源 + 4K原盘 sheet',
      '✅ 跳过 导航首页 sheet',
    ],
    bestFor: '整库批量 (泽泽妈 21-sheet 文档, ~4.5 万条)',
    href: '/admin/import',
  },
  {
    key: 'standard-excel',
    title: '标准 Excel',
    icon: '📊',
    color: 'from-amber-500/20 to-orange-500/20 border-amber-500/40',
    desc: '固定表头 Excel/CSV: 名称/链接/提取码/大小/分类',
    features: [
      '✅ 列名自动识别 (中英兼容)',
      '✅ 链接自动检测网盘类型',
      '✅ 链接内嵌 ?password=xxx 自动提取',
      '⚠️ 一行 = 一资源, 单链接',
    ],
    bestFor: '单链接资源, 中等批量 (百条到几千)',
    href: '/admin/import',
  },
  {
    key: 'doc',
    title: '线上文档',
    icon: '🔗',
    color: 'from-emerald-500/20 to-teal-500/20 border-emerald-500/40',
    desc: '飞书 / 腾讯 / 金山文档 URL, 自动抓取',
    features: [
      '✅ 支持飞书/腾讯/金山文档',
      '✅ 抓取后直接入库',
      '⚠️ 文档需要"可查看"权限',
      '⚠️ 单链接资源',
    ],
    bestFor: '团队维护共享文档, 不想下载 Excel',
    href: '/admin/import',
  },
  {
    key: 'quick',
    title: '快速粘链接',
    icon: '⚡',
    color: 'from-yellow-500/20 to-amber-500/20 border-yellow-500/40',
    desc: '直接粘文本, 一行一条: 片名,链接,提取码',
    features: [
      '✅ CSV/TSV/空格分隔',
      '✅ 自动识别 115/百度/磁力/ed2k',
      '✅ 不用写 Excel',
      '⚠️ 单链接资源',
    ],
    bestFor: '临时几条, 懒得写 Excel',
    href: '/admin/import',
  },
];

const CHANNEL_DISPLAY: Record<string, { name: string; icon: string; desc: string }> = {
  zezemom_excel: { name: '泽泽妈妈文档', icon: '👑', desc: '21-sheet 文档' },
  tg_baidu: { name: 'TG 百度网盘', icon: '🅱️', desc: '百度网盘链接' },
  tg_quark: { name: 'TG 夸克网盘', icon: '🍊', desc: '夸克网盘链接' },
  tg_aliyun: { name: 'TG 阿里云盘', icon: '☁️', desc: '阿里云盘链接' },
  tg_xunlei: { name: 'TG 迅雷网盘', icon: '⚡', desc: '迅雷网盘链接' },
  tg_123: { name: 'TG 123网盘', icon: '🔢', desc: '123 网盘链接' },
  tg_uc: { name: 'TG UC网盘', icon: '🐻', desc: 'UC 网盘链接' },
  tg_tianyi: { name: 'TG 天翼云盘', icon: '📡', desc: '天翼云盘链接' },
  tg_yidong: { name: 'TG 移动云盘', icon: '📱', desc: '移动云盘链接' },
  tg_magnet: { name: 'TG 磁力/ed2k', icon: '🧲', desc: '磁力链/ed2k 链接' },
  tg_music: { name: 'TG 音乐', icon: '🎵', desc: '音乐资源' },
  tg_115: { name: 'TG 115网盘', icon: '💎', desc: '115 网盘链接' },
  tg_telegraph: { name: 'TG Telegraph', icon: '🔗', desc: 'telegra.ph 中间页' },
  tg_other: { name: 'TG 其他', icon: '📦', desc: '未分类' },
};

export default function ImportHubPage() {
  const [stats, setStats] = useState<{ total: number; channels: ChannelStat[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/admin/import-hub-stats');
        const d = await r.json();
        if (d.success) setStats({ total: d.total, channels: d.channels });
      } catch { /* 静默 */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <button onClick={() => window.location.href = '/admin/dashboard'} className="p-2 hover:bg-white/10 rounded-lg transition">←</button>
          <h1 className="text-2xl font-bold">📤 数据导入中心</h1>
        </div>
        <p className="text-sm text-white/50 mb-8 ml-12">5 个入口，按资源类型选最快的路</p>

        {/* 入库统计 */}
        <div className="mb-8 bg-[#12121a] rounded-xl border border-white/5 p-5">
          <h2 className="text-base font-medium mb-4 flex items-center gap-2">
            📊 入库总览
            {loading && <span className="text-xs text-white/40">加载中...</span>}
          </h2>
          {!loading && stats && (
            <>
              <div className="text-2xl font-bold mb-4">
                <span className="text-violet-400">{stats.total.toLocaleString()}</span>
                <span className="text-sm text-white/40 ml-2">条资源</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {stats.channels.map((c) => {
                  const meta = CHANNEL_DISPLAY[c.channel] || { name: c.channel, icon: '📦', desc: '' };
                  return (
                    <div key={c.channel} className="bg-white/5 rounded-lg p-3 flex items-center gap-2">
                      <div className="text-2xl">{meta.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{meta.name}</div>
                        <div className="text-xs text-white/50">{c.count.toLocaleString()} 条</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* 入口卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {HUBS.map((h) => (
            <a
              key={h.key}
              href={h.href}
              className={`relative bg-gradient-to-br ${h.color} border rounded-2xl p-5 transition block hover:scale-[1.01] hover:brightness-110`}
            >
              {h.badge && (
                <div className="absolute top-3 right-3 px-2 py-0.5 bg-gradient-to-r from-pink-500 to-violet-500 rounded-full text-xs font-medium">
                  {h.badge}
                </div>
              )}
              <div className="flex items-center gap-3 mb-3">
                <div className="text-3xl">{h.icon}</div>
                <div>
                  <h3 className="text-lg font-bold">{h.title}</h3>
                  <p className="text-sm text-white/60">{h.desc}</p>
                </div>
              </div>

              <ul className="space-y-1 mb-3 text-sm">
                {h.features.map((f, i) => (
                  <li key={i} className="text-white/70">{f}</li>
                ))}
              </ul>

              <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                <div className="text-xs text-white/50">
                  适合: <span className="text-white/80">{h.bestFor}</span>
                </div>
                <div className="text-violet-400 text-sm">进入 →</div>
              </div>
            </a>
          ))}
        </div>

        {/* 决策指南 */}
        <div className="mt-8 bg-[#12121a] rounded-xl border border-white/5 p-5">
          <h2 className="text-base font-medium mb-3">🤔 不知道用哪个？</h2>
          <div className="space-y-2 text-sm text-white/70">
            <div>• <b className="text-white">我有泽泽妈的 Excel 文档 (21 sheet)</b> → 👑 泽泽妈妈 Excel</div>
            <div>• <b className="text-white">我有 TG 导出的 result.json (一个资源多网盘)</b> → 📡 TG 频道 JSON</div>
            <div>• <b className="text-white">我有 1-2 条想临时加</b> → ⚡ 快速粘链接</div>
            <div>• <b className="text-white">我有标准格式的 Excel/CSV (单链接)</b> → 📊 标准 Excel</div>
            <div>• <b className="text-white">我的资源在飞书/腾讯文档里维护</b> → 🔗 线上文档</div>
          </div>
        </div>
      </div>
    </div>
  );
}
