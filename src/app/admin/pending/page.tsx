'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

interface PendingItem {
  id: number;
  userId: number;
  username: string;
  tmdbId: string;
  tmdbTitle: string;
  tmdbPosterUrl: string | null;
  name: string;
  type: string;
  links: string[];
  linkCount: number;
  size: string | null;
  sizeUnit: string | null;
  note: string | null;
  status: string;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  rejectionReason: string | null;
}

const TOKEN = () => typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || localStorage.getItem('token') || '') : '';

function pointsForType(type: string): number {
  if (type === '4K原盘' || type === '原盘') return 10;
  if (type === '4K' || type === '杜比视界') return 8;
  return 5;
}

export default function AdminPendingPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.user_group !== 'admin' && u?.group !== 'admin') {
        router.push('/login?redirect=/admin/pending');
        return;
      }
      setAuthed(true);
      setChecking(false);
    } catch {
      router.push('/login?redirect=/admin/pending');
    }
  }, [router]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/pending', { headers: { Authorization: `Bearer ${TOKEN()}` } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setItems(d.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed) load();
  }, [authed, pathname]);

  const approve = async (id: number) => {
    if (busy) return;
    if (!confirm('通过审核? 这会入库 + 给用户加积分')) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/pending/${id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN()}` },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setToast(d.message);
      setTimeout(() => setToast(null), 3000);
      await load();
    } catch (e: any) {
      alert('通过失败: ' + e.message);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (id: number) => {
    if (busy) return;
    setBusy(id);
    try {
      const r = await fetch(`/api/admin/pending/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ reason: rejectReason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setToast('已拒绝');
      setTimeout(() => setToast(null), 3000);
      setRejectingId(null);
      setRejectReason('');
      await load();
    } catch (e: any) {
      alert('拒绝失败: ' + e.message);
    } finally {
      setBusy(null);
    }
  };

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white/40 text-sm">校验登录态...</div>;
  }
  if (!authed) return null;

  const filtered = filter === 'pending' ? items.filter(i => i.status === 'pending') : items;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <Link href="/admin" className="text-xs text-white/40 hover:text-white/60">← 返回 admin</Link>
            <h1 className="text-2xl font-bold mt-1">⏳ 待审核资源</h1>
            <p className="text-xs text-white/40 mt-1">通过 = 入库 + 加积分 (4K原盘/原盘=10, 4K/杜比=8, 1080P/720P/REMUX/低分辨率=5)</p>
          </div>
          <div className="flex gap-2 text-xs">
            <button
              onClick={() => setFilter('pending')}
              className={`px-3 py-1.5 rounded ${filter === 'pending' ? 'bg-amber-600 text-white' : 'bg-white/10 text-white/60'}`}>
              待审 ({items.filter(i => i.status === 'pending').length})
            </button>
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded ${filter === 'all' ? 'bg-cyan-600 text-white' : 'bg-white/10 text-white/60'}`}>
              全部 ({items.length})
            </button>
          </div>
        </div>

        {toast && (
          <div className="mb-4 px-4 py-2 bg-emerald-500/20 text-emerald-300 rounded text-sm">{toast}</div>
        )}

        {loading ? (
          <div className="text-center text-white/40 py-16">加载中...</div>
        ) : error ? (
          <div className="text-red-400 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-white/40 py-16">
            {filter === 'pending' ? '✅ 没有待审核的资源' : '没有数据'}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(item => (
              <div key={item.id} className="bg-white/5 rounded-lg p-3">
                <div className="flex items-start gap-3">
                  {/* TMDB 海报 */}
                  {item.tmdbPosterUrl ? (
                    <img src={item.tmdbPosterUrl} alt={item.tmdbTitle} className="w-12 h-16 object-cover rounded flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-16 bg-white/10 rounded flex items-center justify-center text-white/30 text-xs flex-shrink-0">🎬</div>
                  )}

                  {/* 中间信息 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">{item.tmdbTitle}</span>
                      <span className="px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded text-[10px]">{item.type}</span>
                      {item.size && <span className="text-[10px] text-white/40">{item.size} {item.sizeUnit}</span>}
                      <span className="text-[10px] text-white/40">{item.linkCount} 链接</span>
                      {item.status === 'pending' ? (
                        <span className="px-1.5 py-0.5 bg-amber-500/30 text-amber-300 rounded text-[10px]">待审</span>
                      ) : item.status === 'approved' ? (
                        <span className="px-1.5 py-0.5 bg-emerald-500/30 text-emerald-300 rounded text-[10px]">✓ 已通过</span>
                      ) : (
                        <span className="px-1.5 py-0.5 bg-red-500/30 text-red-300 rounded text-[10px]">✗ 已拒</span>
                      )}
                    </div>
                    <div className="text-[10px] text-white/40">
                      {item.username} · {new Date(item.submittedAt).toLocaleString('zh-CN')}
                      {item.reviewedAt && ` · 审核于 ${new Date(item.reviewedAt).toLocaleString('zh-CN')}`}
                    </div>
                    {item.note && <div className="text-[10px] text-white/50 mt-1">📝 {item.note}</div>}

                    {/* 展开/收起 links */}
                    {expandedId === item.id && (
                      <div className="mt-2 space-y-1">
                        {item.links.map((l, idx) => (
                          <div key={idx} className="text-[10px] text-white/60 font-mono break-all bg-black/30 px-2 py-1 rounded">{l}</div>
                        ))}
                      </div>
                    )}

                    {item.rejectionReason && (
                      <div className="text-[10px] text-red-300 mt-1">拒绝原因: {item.rejectionReason}</div>
                    )}
                  </div>

                  {/* 操作 */}
                  <div className="flex flex-col gap-1 flex-shrink-0">
                    <button
                      onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px]">
                      {expandedId === item.id ? '收起链接' : '看链接'}
                    </button>
                    {item.status === 'pending' && (
                      <>
                        {rejectingId === item.id ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={e => setRejectReason(e.target.value)}
                              placeholder="拒绝原因 (可选)"
                              className="px-2 py-1 bg-black/40 border border-white/10 rounded text-[10px] w-32"
                            />
                            <div className="flex gap-1">
                              <button
                                onClick={() => reject(item.id)}
                                disabled={busy === item.id}
                                className="px-2 py-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded text-[10px]">
                                确认
                              </button>
                              <button
                                onClick={() => { setRejectingId(null); setRejectReason(''); }}
                                className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-[10px]">
                                取消
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <button
                              onClick={() => approve(item.id)}
                              disabled={busy === item.id}
                              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded text-[10px] font-semibold">
                              {busy === item.id ? '处理中' : `通过 +${pointsForType(item.type)}`}
                            </button>
                            <button
                              onClick={() => { setRejectingId(item.id); setRejectReason(''); }}
                              className="px-2 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded text-[10px]">
                              拒绝
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
