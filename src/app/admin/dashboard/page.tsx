'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  BarChart3, Users, Key, FileText, Target, Upload, DollarSign,
  ShieldOff, Code2, Settings, ListChecks, Database, Network, Activity,
  Zap, Server, AlertCircle, Tv, ExternalLink, RefreshCw, CheckCircle2, XCircle,
} from 'lucide-react';

interface Card {
  id: string;
  title: string;
  desc: string;
  icon: any;
  href: string;
  category: string;
  external?: boolean;
  color: string;
  bg: string;
}

const CARDS: Card[] = [
  // ===== 资源管理 (zzmm-search 内部) =====
  { id: 'import', title: '泽泽妈文档导入', desc: '21 sheet 文档批量导入', icon: Upload, href: '/admin/import', category: '资源管理', color: 'text-violet-700', bg: 'bg-violet-50 hover:bg-violet-100' },
  { id: 'import-tg', title: 'TG 频道导入', desc: 'result.json → VIP 锁资源 (L1+L2+L3 队列)', icon: Network, href: '/admin/import-tg', category: '资源管理', color: 'text-cyan-700', bg: 'bg-cyan-50 hover:bg-cyan-100' },
  { id: 'match', title: 'TMDB 匹配', desc: '单条手动匹配 / 占位符识别', icon: Target, href: '/admin/match', category: '资源管理', color: 'text-blue-700', bg: 'bg-blue-50 hover:bg-blue-100' },
  { id: 'tg-organize', title: 'TG 群整理', desc: '115 群消息审核入库', icon: ListChecks, href: '/admin/tg-organize', category: '资源管理', color: 'text-cyan-700', bg: 'bg-cyan-50 hover:bg-cyan-100' },
  { id: 'pay-config', title: '单条付费配置', desc: '按类别/资源设 unlock 价格', icon: DollarSign, href: '/admin/pay-config', category: '资源管理', color: 'text-emerald-700', bg: 'bg-emerald-50 hover:bg-emerald-100' },
  { id: 'publish', title: '手动发布资源', desc: '发布单条到主站', icon: FileText, href: '/admin/publish', category: '资源管理', color: 'text-amber-700', bg: 'bg-amber-50 hover:bg-amber-100' },

  // ===== 用户管理 =====
  { id: 'invites', title: '邀请码', desc: '生成/列表/复制/清理', icon: Key, href: '/admin/invites', category: '用户管理', color: 'text-rose-700', bg: 'bg-rose-50 hover:bg-rose-100' },
  { id: 'blacklist', title: '黑名单', desc: '用户/IP/设备拉黑', icon: ShieldOff, href: '/admin/blacklist', category: '用户管理', color: 'text-red-700', bg: 'bg-red-50 hover:bg-red-100' },
  { id: 'codes', title: '激活码', desc: '4 模板 + 流明码', icon: Code2, href: '/admin/codes', category: '用户管理', color: 'text-pink-700', bg: 'bg-pink-50 hover:bg-pink-100' },
  { id: 'users', title: '用户列表', desc: '查/改用户状态', icon: Users, href: '/api/admin/users?pageSize=50', category: '用户管理', color: 'text-fuchsia-700', bg: 'bg-fuchsia-50 hover:bg-fuchsia-100', external: true },

  // ===== 统计 =====
  { id: 'stats-dashboard', title: '数据大屏', desc: '6 大总览 + 4 图表', icon: BarChart3, href: '/admin/stats-dashboard', category: '数据统计', color: 'text-indigo-700', bg: 'bg-indigo-50 hover:bg-indigo-100' },

  // ===== 115 刮削 (scraper-app 外部跳转) =====
  { id: 'scraper', title: 'scraper-app 控制台', desc: '115 刮削任务/分享/账号', icon: Tv, href: 'https://scraper.cc.cd/admin', category: '115 刮削', color: 'text-orange-700', bg: 'bg-orange-50 hover:bg-orange-100', external: true },

  // ===== 同步桥 (import-bridge NAS Docker) =====
  { id: 'bridge-health', title: '同步桥健康', desc: 'import-bridge 状态', icon: Activity, href: '/api/admin/bridge-health', category: '同步桥', color: 'text-teal-700', bg: 'bg-teal-50 hover:bg-teal-100' },
  { id: 'bridge-status', title: '死信队列', desc: '查看推送失败资源', icon: AlertCircle, href: '/api/admin/bridge-status', category: '同步桥', color: 'text-yellow-700', bg: 'bg-yellow-50 hover:bg-yellow-100' },

  // ===== 工具 =====
  { id: 'db-test', title: 'DB 连接测试', desc: 'Neon 连通性', icon: Database, href: '/api/admin/db-test', category: '工具', color: 'text-slate-700', bg: 'bg-slate-50 hover:bg-slate-100', external: true },
  { id: 'network', title: '网络测速', desc: '外部 API 连通', icon: Network, href: '/api/admin/network-test', category: '工具', color: 'text-slate-700', bg: 'bg-slate-50 hover:bg-slate-100', external: true },
  { id: 'smoke', title: 'API smoke test', desc: '一键测所有 admin API', icon: Zap, href: '/admin/smoke-test', category: '工具', color: 'text-slate-700', bg: 'bg-slate-50 hover:bg-slate-100' },
];

const CATEGORIES = Array.from(new Set(CARDS.map(c => c.category)));
const CAT_ICONS: Record<string, any> = {
  '资源管理': FileText, '用户管理': Users, '数据统计': BarChart3,
  '115 刮削': Tv, '同步桥': Activity, '工具': Settings,
};
const CAT_COLORS: Record<string, string> = {
  '资源管理': 'border-violet-300 bg-violet-50/50',
  '用户管理': 'border-rose-300 bg-rose-50/50',
  '数据统计': 'border-indigo-300 bg-indigo-50/50',
  '115 刮削': 'border-orange-300 bg-orange-50/50',
  '同步桥': 'border-teal-300 bg-teal-50/50',
  '工具': 'border-slate-300 bg-slate-50/50',
};

export default function AdminDashboard() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [bridgeHealth, setBridgeHealth] = useState<any>(null);

  useEffect(() => {
    // 2026-07-17: 之前用 document.cookie 读 httpOnly cookie 永远读不到, 改用 localStorage
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.group !== 'admin') {
        router.push('/login?redirect=/admin');
        return;
      }
      setAuthed(true);
      setChecking(false);
      fetchStats();
      fetchBridge();
    } catch {
      router.push('/login?redirect=/admin');
    }
  }, [router]);

  const fetchStats = async () => {
    try {
      const r = await fetch('/api/admin/stats/dashboard');
      const j = await r.json();
      if (!j.error) setStats(j);
    } catch {}
  };

  const fetchBridge = async () => {
    try {
      const r = await fetch('/api/admin/bridge-health');
      const j = await r.json();
      setBridgeHealth(j);
    } catch {}
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">校验登录态...</div>
      </div>
    );
  }

  if (!authed) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white text-lg">🛠️</div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">zzmm 统一控制台</h1>
              <p className="text-xs text-gray-500">所有后台工具一站式入口 · admin@zzmm-search.cc.cd</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { fetchStats(); fetchBridge(); }} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-700 flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> 刷新状态
            </button>
            <Link href="/" className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs text-gray-700">← 返回主站</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 顶部状态卡 */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">资源总数</div>
            <div className="text-2xl font-bold text-gray-900">{(stats?.total_resources ?? '—').toLocaleString?.() ?? stats?.total_resources ?? '—'}</div>
            <div className="text-[10px] text-gray-400 mt-1">xx_resources</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">激活用户</div>
            <div className="text-2xl font-bold text-emerald-600">{(stats?.active_users ?? '—').toLocaleString?.() ?? stats?.active_users ?? '—'}</div>
            <div className="text-[10px] text-gray-400 mt-1">basic + vip + admin</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">激活码</div>
            <div className="text-2xl font-bold text-violet-600">{(stats?.total_codes ?? '—').toLocaleString?.() ?? stats?.total_codes ?? '—'}</div>
            <div className="text-[10px] text-gray-400 mt-1">已用 / 总数</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-xs text-gray-500 mb-1">同步桥</div>
            <div className="flex items-center gap-2 mt-1">
              {bridgeHealth?.ok ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <XCircle className="w-5 h-5 text-red-500" />}
              <div className="text-sm font-medium text-gray-700">
                {bridgeHealth?.ok ? `运行中` : bridgeHealth ? '离线' : '检测中...'}
              </div>
            </div>
            <div className="text-[10px] text-gray-400 mt-1">NAS Docker</div>
          </div>
        </section>

        {/* 分组卡片 */}
        {CATEGORIES.map(cat => {
          const Icon = CAT_ICONS[cat];
          const cards = CARDS.filter(c => c.category === cat);
          return (
            <section key={cat} className={`mb-6 border-2 rounded-2xl p-5 ${CAT_COLORS[cat]}`}>
              <h2 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Icon className="w-4 h-4" />
                {cat}
                <span className="text-[10px] text-gray-400 font-normal">({cards.length})</span>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {cards.map(card => {
                  const CardIcon = card.icon;
                  const inner = (
                    <div className={`rounded-xl p-4 transition border border-gray-200 ${card.bg} h-full`}>
                      <div className="flex items-start justify-between mb-2">
                        <CardIcon className={`w-5 h-5 ${card.color}`} />
                        {card.external && <ExternalLink className="w-3 h-3 text-gray-400" />}
                      </div>
                      <div className={`text-sm font-semibold ${card.color} mb-1`}>{card.title}</div>
                      <div className="text-[11px] text-gray-500 leading-relaxed">{card.desc}</div>
                    </div>
                  );
                  if (card.href.startsWith('http') || card.href.startsWith('/api/')) {
                    return (
                      <a key={card.id} href={card.href} target={card.external ? '_blank' : undefined} rel="noopener noreferrer" className="block">
                        {inner}
                      </a>
                    );
                  }
                  return (
                    <Link key={card.id} href={card.href} className="block">
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}

        <footer className="text-center text-xs text-gray-400 mt-8 pb-4">
          zzmm-search v2.2.1 · 控制台 · 点击卡片进入工具
        </footer>
      </main>
    </div>
  );
}