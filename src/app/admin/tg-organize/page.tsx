'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, RefreshCw, Trash2, ChevronRight, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon, FileText, Clock } from 'lucide-react';

interface Candidate {
  id: number;
  group_name: string;
  message_id: number;
  message_text: string;
  raw_links: string[];
  detected_resources: any[];
  source: string;
  created_at: string;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

interface Stats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export default function TgOrganizePage() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [stats, setStats] = useState<Stats>({ pending: 0, approved: 0, rejected: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('zzmm_token') || '';
      const r = await fetch(`/api/admin/tg-organize?status=${statusFilter}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.error) { showToast('error', d.error); return; }
      setCandidates(d.items || []);
      setStats(d.stats || { pending: 0, approved: 0, rejected: 0, total: 0 });
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const handleReview = async (id: number, action: 'approve' | 'reject') => {
    const token = localStorage.getItem('zzmm_token') || '';
    try {
      const r = await fetch('/api/admin/tg-organize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, action }),
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else {
        showToast('success', `✓ 已${action === 'approve' ? '批准' : '拒绝'}`);
        load();
      }
    } catch (e: any) { showToast('error', e.message); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除？')) return;
    const token = localStorage.getItem('zzmm_token') || '';
    try {
      const r = await fetch(`/api/admin/tg-organize?id=${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      const d = await r.json();
      if (d.error) showToast('error', d.error);
      else { showToast('success', '✓ 已删除'); load(); }
    } catch (e: any) { showToast('error', e.message); }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Send className="w-6 h-6 text-cyan-400" /> TG 群整理
        </h1>
        <button onClick={load} disabled={loading} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center gap-1">
          <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} /> 刷新
        </button>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-[#12121a] rounded-xl p-4 border border-amber-500/20">
          <div className="text-xs text-amber-300/80">待审核</div>
          <div className="text-2xl font-bold mt-1 text-amber-300">{stats.pending}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-emerald-500/20">
          <div className="text-xs text-emerald-300/80">已批准</div>
          <div className="text-2xl font-bold mt-1 text-emerald-300">{stats.approved}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-red-500/20">
          <div className="text-xs text-red-300/80">已拒绝</div>
          <div className="text-2xl font-bold mt-1 text-red-300">{stats.rejected}</div>
        </div>
        <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
          <div className="text-xs text-white/40">总计</div>
          <div className="text-2xl font-bold mt-1">{stats.total}</div>
        </div>
      </div>

      {/* 状态过滤 */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-sm ${statusFilter === s ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            {s === 'pending' ? '⏳ 待审核' : s === 'approved' ? '✓ 已批准' : s === 'rejected' ? '✗ 已拒绝' : '📋 全部'}
          </button>
        ))}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="text-center py-12 text-white/40 flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> 加载中...
        </div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-16 text-white/40 bg-[#12121a] rounded-2xl">
          <div className="text-4xl mb-2">📭</div>
          <div className="text-sm">暂无{statusFilter === 'pending' ? '待审核' : ''}数据</div>
          <div className="text-xs text-white/30 mt-1">TG 群消息会自动导入到这里</div>
        </div>
      ) : (
        <div className="space-y-2">
          {candidates.map(c => (
            <motion.div key={c.id} layout className="bg-[#12121a] rounded-xl border border-white/5 overflow-hidden">
              <div className="p-4 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="px-2 py-0.5 bg-cyan-500/20 text-cyan-300 rounded text-xs font-medium">
                      📡 {c.group_name || '未知群'}
                    </span>
                    <span className="text-xs text-white/40 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {new Date(c.created_at).toLocaleString('zh-CN')}
                    </span>
                    {c.status === 'pending' && <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">待审核</span>}
                    {c.status === 'approved' && <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs">已批准</span>}
                    {c.status === 'rejected' && <span className="px-2 py-0.5 bg-red-500/20 text-red-300 rounded text-xs">已拒绝</span>}
                  </div>
                  <div className="text-sm text-white/80 line-clamp-2 mb-1">
                    {c.message_text || '(无文本)'}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-white/40">
                    {c.detected_resources?.length > 0 && (
                      <span className="text-emerald-300">✓ 检测到 {c.detected_resources.length} 个资源</span>
                    )}
                    {c.raw_links?.length > 0 && (
                      <span>🔗 {c.raw_links.length} 个链接</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {c.status === 'pending' && (
                    <>
                      <button onClick={() => handleReview(c.id, 'approve')}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-xs">
                        ✓ 批准
                      </button>
                      <button onClick={() => handleReview(c.id, 'reject')}
                        className="px-2 py-1 bg-red-600/70 hover:bg-red-500 rounded text-xs">
                        ✗ 拒绝
                      </button>
                    </>
                  )}
                  <button onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                    className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">
                    <ChevronRight className={'w-3 h-3 transition-transform ' + (expandedId === c.id ? 'rotate-90' : '')} />
                  </button>
                  <button onClick={() => handleDelete(c.id)}
                    className="px-2 py-1 bg-white/5 hover:bg-red-500/20 rounded text-xs text-red-300">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <AnimatePresence>
                {expandedId === c.id && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                    className="border-t border-white/5 bg-black/30 overflow-hidden">
                    <div className="p-4 space-y-3 text-xs">
                      <div>
                        <div className="text-white/40 mb-1">原始消息:</div>
                        <pre className="whitespace-pre-wrap text-white/70 bg-black/30 p-2 rounded max-h-40 overflow-y-auto">
                          {c.message_text || '(无)'}
                        </pre>
                      </div>
                      {c.raw_links?.length > 0 && (
                        <div>
                          <div className="text-white/40 mb-1">链接 ({c.raw_links.length}):</div>
                          <div className="space-y-1">
                            {c.raw_links.map((l, i) => (
                              <div key={i} className="font-mono text-cyan-300 break-all">{l}</div>
                            ))}
                          </div>
                        </div>
                      )}
                      {c.detected_resources?.length > 0 && (
                        <div>
                          <div className="text-white/40 mb-1">检测到的资源:</div>
                          <pre className="text-emerald-300 bg-black/30 p-2 rounded">
                            {JSON.stringify(c.detected_resources, null, 2)}
                          </pre>
                        </div>
                      )}
                      {c.reviewed_by && (
                        <div className="text-white/40">
                          审核人: {c.reviewed_by} · {c.reviewed_at && new Date(c.reviewed_at).toLocaleString('zh-CN')}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className={`fixed bottom-6 right-6 px-4 py-3 rounded-xl shadow-lg text-sm z-50 ${toast.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {toast.msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}