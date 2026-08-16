'use client';

import { useEffect, useState } from 'react';

// 2026-08-16 viewer-role: 后台待确认注册列表 + 审核 UI
export default function AdminPendingUsersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewing, setReviewing] = useState<number | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [filter, setFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      const res = await fetch('/api/admin/pending-users', {
        headers: { 'Authorization': 'Bearer ' + token },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        setItems([]);
      } else {
        setItems(data.items || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleReview = async (userId: number, action: 'approve' | 'reject') => {
    if (action === 'reject' && !reviewNote.trim()) {
      alert('请填写拒绝原因');
      return;
    }
    if (!confirm(`${action === 'approve' ? '通过' : '拒绝'}用户 ID=${userId} ?`)) return;

    try {
      const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      const res = await fetch('/api/admin/pending-users', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, action, review_note: reviewNote.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '操作失败');
        return;
      }
      alert(`✅ 已${action === 'approve' ? '通过' : '拒绝'}`);
      setReviewing(null);
      setReviewNote('');
      load();
    } catch (e: any) {
      alert('网络错误: ' + e.message);
    }
  };

  const filtered = items.filter(i => {
    if (!filter) return true;
    const s = filter.toLowerCase();
    return i.username?.toLowerCase().includes(s) ||
      i.wechat_name?.toLowerCase().includes(s) ||
      i.wechat_id?.toLowerCase().includes(s);
  });

  return (
    <div className="min-h-screen bg-[#0a0a0f] p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">⏳ 待确认注册审核</h1>
            <p className="text-sm text-white/50 mt-1">无邀请码申请的 viewer 账号审核（通过后只能看文档资源 + 个人主页）</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索用户名/微信"
              className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={load}
              className="px-3 py-1.5 bg-violet-500/20 hover:bg-violet-500/30 text-violet-300 rounded-lg text-sm transition"
            >
              🔄 刷新
            </button>
            <span className="text-sm text-white/40">共 {items.length} 条</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-center text-white/40 py-12">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-white/40 py-12">
            {items.length === 0 ? '✅ 暂无待审核用户' : '🔍 无匹配结果'}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((u) => (
              <div
                key={u.id}
                className="bg-[#12121a] border border-white/5 rounded-xl p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg font-semibold text-white">{u.username}</span>
                      <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">
                        {u.user_group}
                      </span>
                      <span className="text-xs text-white/40">
                        ID: {u.id} · {new Date(u.created_at).toLocaleString('zh-CN')}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                      {u.wechat_name && (
                        <div className="text-white/60">📱 微信名: <span className="text-white/90">{u.wechat_name}</span></div>
                      )}
                      {u.wechat_id && (
                        <div className="text-white/60">📱 微信号: <span className="text-white/90 font-mono">{u.wechat_id}</span></div>
                      )}
                      {u.application_reason && (
                        <div className="col-span-2 text-white/60">
                          📝 申请理由: <span className="text-white/80">{u.application_reason}</span>
                        </div>
                      )}
                      {u.review_note && (
                        <div className="col-span-2 text-white/60">
                          📋 历史审核备注: <span className="text-white/50">{u.review_note}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {reviewing === u.id ? (
                      <>
                        <textarea
                          value={reviewNote}
                          onChange={(e) => setReviewNote(e.target.value)}
                          placeholder={u.review_note ? '审核备注' : '拒绝必填原因'}
                          rows={2}
                          className="w-64 px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white placeholder-white/30 focus:outline-none focus:border-amber-500/50 resize-none"
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={() => handleReview(u.id, 'approve')}
                            className="flex-1 px-2 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded text-xs transition"
                          >
                            ✅ 通过
                          </button>
                          <button
                            onClick={() => handleReview(u.id, 'reject')}
                            className="flex-1 px-2 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded text-xs transition"
                          >
                            ❌ 拒绝
                          </button>
                          <button
                            onClick={() => { setReviewing(null); setReviewNote(''); }}
                            className="px-2 py-1.5 bg-white/5 hover:bg-white/10 text-white/60 rounded text-xs transition"
                          >
                            取消
                          </button>
                        </div>
                      </>
                    ) : (
                      <button
                        onClick={() => { setReviewing(u.id); setReviewNote(u.review_note || ''); }}
                        className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 rounded-lg text-sm transition"
                      >
                        🔍 审核
                      </button>
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
