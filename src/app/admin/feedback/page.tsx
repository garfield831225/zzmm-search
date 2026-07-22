'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';

interface FeedbackItem {
  id: number;
  link_id: number | null;
  resource_id: number;
  source: string;
  reason: string;
  comment: string;
  new_password: string;
  status: string;
  admin_note: string;
  username: string;
  user_id: number;
  created_at: string;
  handled_at: string | null;
  resource_name?: string;
  resource_category?: string;
}

const REASON_COLORS: Record<string, string> = {
  '失效': 'bg-red-500/20 text-red-300',
  '限速': 'bg-amber-500/20 text-amber-300',
  '密码错': 'bg-yellow-500/20 text-yellow-300',
  '内容错': 'bg-purple-500/20 text-purple-300',
  '其他': 'bg-white/10 text-white/60',
};

const STATUS_TABS = [
  { value: 'pending', label: '🆕 待处理' },
  { value: 'handled', label: '✅ 已处理' },
  { value: 'ignored', label: '🚫 已忽略' },
];

export default function AdminFeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('pending');
  const [editing, setEditing] = useState<{ id: number; note: string } | null>(null);

  const getToken = () => localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/feedback?status=${status}&limit=200`, { headers: { Authorization: 'Bearer ' + getToken() } });
      const d = await r.json();
      if (d.ok) {
        setItems(d.items);
        const map: Record<string, number> = {};
        for (const b of d.by_status || []) map[b.status] = b.cnt;
        setByStatus(map);
      }
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handle = async (id: number, action: 'handled' | 'ignored') => {
    const note = editing?.id === id ? editing.note : '';
    const r = await fetch('/api/admin/feedback', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getToken() },
      body: JSON.stringify({ id, action, admin_note: note })
    });
    const d = await r.json();
    if (d.ok) { setEditing(null); fetchList(); }
  };

  const jumpToResource = (resourceId: number) => {
    window.open(`/tmdb/movie/${resourceId}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <a href="/admin" className="p-2 hover:bg-white/10 rounded-lg">←</a>
          <div>
            <h1 className="text-2xl font-bold">📬 失效反馈</h1>
            <p className="text-sm text-white/40">用户提交的链接失效反馈 — 处理后会通知用户</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          {STATUS_TABS.map(t => (
            <button key={t.value} onClick={() => setStatus(t.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                status === t.value ? 'bg-violet-500/30 border border-violet-500/50' : 'bg-white/5 hover:bg-white/10 border border-white/10'
              }`}>
              {t.label} <span className="ml-1 text-white/40">({byStatus[t.value] || 0})</span>
            </button>
          ))}
          <button onClick={fetchList} className="ml-auto px-3 py-2 text-xs bg-white/5 hover:bg-white/10 rounded-lg">🔄 刷新</button>
        </div>

        {loading && <div className="text-center text-white/40 py-8">加载中...</div>}

        {!loading && items.length === 0 && (
          <div className="text-center text-white/40 py-16 bg-white/5 rounded-xl">📭 没有 {STATUS_TABS.find(t => t.value === status)?.label} 的反馈</div>
        )}

        <div className="space-y-2">
          {items.map(f => (
            <motion.div key={f.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
              className="bg-[#12121a] rounded-xl border border-white/5 p-4">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${REASON_COLORS[f.reason] || REASON_COLORS['其他']}`}>
                      {f.reason}
                    </span>
                    <span className="px-2 py-0.5 bg-white/10 rounded text-xs">{f.source}</span>
                    <span className="text-xs text-white/40">#{f.id}</span>
                    <span className="text-xs text-white/40">{f.username} 提交于 {new Date(f.created_at).toLocaleString('zh-CN')}</span>
                  </div>
                  <div className="mt-2 text-sm font-medium">{f.resource_name || `资源 #${f.resource_id}`}</div>
                  {f.resource_category && <div className="text-xs text-white/40">{f.resource_category}</div>}
                  {f.comment && <div className="mt-2 text-sm text-white/70 bg-white/5 p-2 rounded">💬 {f.comment}</div>}
                  {f.new_password && <div className="mt-2 text-sm text-cyan-300 bg-cyan-500/10 p-2 rounded">🔑 用户提供新密码: {f.new_password}</div>}
                  {f.admin_note && (
                    <div className="mt-2 text-xs text-white/40 bg-white/5 p-2 rounded">
                      📝 Admin 备注: {f.admin_note}
                      {f.handled_at && <span className="ml-2 text-white/30">{new Date(f.handled_at).toLocaleString('zh-CN')}</span>}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {status === 'pending' && (
                    <>
                      <button onClick={() => jumpToResource(f.resource_id)} className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-500 rounded">🔗 跳到资源</button>
                      <input
                        placeholder="备注 (可选)"
                        value={editing?.id === f.id ? editing.note : ''}
                        onChange={e => setEditing({ id: f.id, note: e.target.value })}
                        className="px-2 py-1 text-xs bg-white/5 border border-white/10 rounded w-40"
                      />
                      <button onClick={() => handle(f.id, 'handled')} className="px-3 py-1 text-xs bg-green-600 hover:bg-green-500 rounded">✅ 处理</button>
                      <button onClick={() => handle(f.id, 'ignored')} className="px-3 py-1 text-xs bg-white/10 hover:bg-white/20 rounded">🚫 忽略</button>
                    </>
                  )}
                  {status !== 'pending' && (
                    <button onClick={() => jumpToResource(f.resource_id)} className="px-3 py-1 text-xs bg-white/5 hover:bg-white/10 rounded">🔗 跳到资源</button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
