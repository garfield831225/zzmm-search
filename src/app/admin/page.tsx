'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';

interface Stats {
  totalResources: number;
  totalUsers: number;
  activeUsers: number;
  totalViews: number;
  sourceStats: Record<string, number>;
  categoryStats: Record<string, number>;
}

interface LogItem {
  id: number;
  action: string;
  target: string;
  detail: string;
  created_at: string;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      setStats(data.stats);
      setRecentLogs(data.recentLogs || []);
    } catch (err) {
      console.error('Fetch stats error:', err);
    } finally {
      setLoading(false);
    }
  };

  const adminNavItems = [
    { key: 'dashboard', label: '📊 数据统计', icon: '📊' },
    { key: 'users', label: '👥 用户管理', icon: '👥' },
    { key: 'resources', label: '📁 资源管理', icon: '📁' },
    { key: 'plans', label: '💰 套餐管理', icon: '💰' },
    { key: 'codes', label: '🔑 激活码', icon: '🔑' },
    { key: 'docs', label: '📄 线上文档', icon: '📄' },
    { key: 'announcements', label: '📢 公告管理', icon: '📢' },
    { key: 'settings', label: '⚙️ 系统设置', icon: '⚙️' },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="text-white/60">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#12121a] border-r border-white/5 shrink-0">
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center">
              <span>🎬</span>
            </div>
            <div>
              <div className="font-bold">管理后台</div>
              <div className="text-xs text-white/40">管理员</div>
            </div>
          </div>
        </div>

        <nav className="p-2">
          {adminNavItems.map((item) => (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition ${
                activeTab === item.key
                  ? 'bg-violet-600 text-white'
                  : 'text-white/60 hover:bg-white/5'
              }`}
            >
              {item.icon} {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-6 overflow-auto">
        {activeTab === 'dashboard' && stats && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <h2 className="text-2xl font-bold mb-6">数据统计</h2>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <div className="text-white/60 text-sm mb-2">资源总数</div>
                <div className="text-3xl font-bold">{stats.totalResources.toLocaleString()}</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <div className="text-white/60 text-sm mb-2">用户总数</div>
                <div className="text-3xl font-bold">{stats.totalUsers.toLocaleString()}</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <div className="text-white/60 text-sm mb-2">活跃用户</div>
                <div className="text-3xl font-bold text-green-400">{stats.activeUsers.toLocaleString()}</div>
              </div>
              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <div className="text-white/60 text-sm mb-2">总浏览量</div>
                <div className="text-3xl font-bold text-yellow-400">{stats.totalViews.toLocaleString()}</div>
              </div>
            </div>

            {/* Source & Category Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <h3 className="font-semibold mb-4">来源分布</h3>
                <div className="space-y-3">
                  {Object.entries(stats.sourceStats).map(([source, count]) => (
                    <div key={source} className="flex items-center gap-3">
                      <span className="w-24 text-sm text-white/60">{source}</span>
                      <div className="flex-1 bg-white/5 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full"
                          style={{ width: `${(count / stats.totalResources) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
                <h3 className="font-semibold mb-4">分类分布</h3>
                <div className="space-y-3">
                  {Object.entries(stats.categoryStats).map(([cat, count]) => (
                    <div key={cat} className="flex items-center gap-3">
                      <span className="w-24 text-sm text-white/60">{cat}</span>
                      <div className="flex-1 bg-white/5 rounded-full h-2">
                        <div
                          className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full"
                          style={{ width: `${(count / stats.totalResources) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Logs */}
            <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
              <h3 className="font-semibold mb-4">最近操作</h3>
              <div className="space-y-2">
                {recentLogs.map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div>
                      <span className="text-sm">{log.action}</span>
                      {log.target && <span className="text-white/40 text-sm ml-2">{log.target}</span>}
                    </div>
                    <span className="text-xs text-white/40">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'users' && <UserManagement />}
        {activeTab === 'resources' && <ResourceManagement />}
        {activeTab === 'plans' && <PlanManagement />}
        {activeTab === 'codes' && <CodeManagement />}
        {activeTab === 'docs' && <DocConfig />}
        {activeTab === 'announcements' && <AnnouncementManagement />}
        {activeTab === 'settings' && <SystemSettings />}
      </main>
    </div>
  );
}

// Sub-components
function UserManagement() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">用户管理</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">用户列表将在此处显示...</p>
      </div>
    </div>
  );
}

function ResourceManagement() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">资源管理</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">资源列表将在此处显示...</p>
      </div>
    </div>
  );
}

function PlanManagement() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">套餐管理</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">套餐列表将在此处显示...</p>
      </div>
    </div>
  );
}

function CodeManagement() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">激活码管理</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">激活码列表将在此处显示...</p>
      </div>
    </div>
  );
}

function DocConfig() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">线上文档配置</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">文档配置将在此处显示...</p>
      </div>
    </div>
  );
}

function AnnouncementManagement() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">公告管理</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">公告列表将在此处显示...</p>
      </div>
    </div>
  );
}

function SystemSettings() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">系统设置</h2>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5">
        <p className="text-white/60">系统设置将在此处显示...</p>
      </div>
    </div>
  );
}