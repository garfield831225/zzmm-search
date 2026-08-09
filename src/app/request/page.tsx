'use client';
// 2026-08-05: 求片专区 + 积分兑流明
//   - tab1: 全部求片 (open) 列表
//   - tab2: 我的求片
//   - tab3: 积分兑换流明 (10:1)
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Send, Coins, Sparkles, Check, X } from 'lucide-react';

const TOKEN = () => typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || localStorage.getItem('token') || '') : '';

interface RequestItem {
  id: number;
  userId: number;
  username: string;
  tmdbId: number | null;
  tmdbType: string | null;
  title: string;
  reason: string | null;
  lumenCost: number;
  status: 'open' | 'claimed' | 'fulfilled' | 'cancelled';
  fulfilledBy: number | null;
  createdAt: string;
  fulfilledAt: string | null;
}

export default function RequestPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'mine' | 'redeem'>('all');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 积分兑流明
  const [points, setPoints] = useState(0);
  const [lumen, setLumen] = useState(0);
  const [redeemAmount, setRedeemAmount] = useState(10);
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [redeeming, setRedeeming] = useState(false);

  // 提交求片
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ tmdbId: '', tmdbType: 'movie', title: '', reason: '', lumenCost: 1 });
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const status = tab === 'mine' ? 'mine' : 'open';
      const r = await fetch(`/api/requests?status=${status}&pageSize=50`, { headers: { Authorization: `Bearer ${TOKEN()}` } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setItems(d.items || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBalance = async () => {
    try {
      const r = await fetch('/api/user/balance', { headers: { Authorization: `Bearer ${TOKEN()}` } });
      const d = await r.json();
      if (typeof d.points === 'number') setPoints(d.points);
      if (typeof d.lumen_balance === 'number') setLumen(d.lumen_balance);
    } catch {}
  };

  useEffect(() => {
    if (tab === 'redeem') {
      loadBalance();
    } else {
      load();
    }
  }, [tab]);

  const submitRequest = async () => {
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const r = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({
          tmdb_id: form.tmdbId || null,
          tmdb_type: form.tmdbId ? form.tmdbType : null,
          title: form.title,
          reason: form.reason || null,
          lumen_cost: form.lumenCost,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        setSubmitMsg({ ok: false, text: '❌ ' + (d.error || `HTTP ${r.status}`) });
        setSubmitting(false);
        return;
      }
      setSubmitMsg({ ok: true, text: d.message });
      setTimeout(() => {
        setShowForm(false);
        setForm({ tmdbId: '', tmdbType: 'movie', title: '', reason: '', lumenCost: 1 });
        setSubmitMsg(null);
        setTab('mine');
      }, 2000);
    } catch (e: any) {
      setSubmitMsg({ ok: false, text: '❌ ' + e.message });
    } finally {
      setSubmitting(false);
    }
  };

  const claim = async (id: number) => {
    if (!confirm('接单这个求片? 上传链接后 admin 审核通过即可完成')) return;
    try {
      const r = await fetch(`/api/requests/${id}/claim`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN()}` } });
      const d = await r.json();
      if (!r.ok) {
        alert('❌ ' + (d.error || `HTTP ${r.status}`));
        return;
      }
      alert(d.message);
      load();
    } catch (e: any) {
      alert('❌ ' + e.message);
    }
  };

  const doRedeem = async () => {
    setRedeeming(true);
    setRedeemMsg(null);
    try {
      const r = await fetch('/api/points/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN()}` },
        body: JSON.stringify({ amount: redeemAmount }),
      });
      const d = await r.json();
      if (!r.ok) {
        setRedeemMsg({ ok: false, text: '❌ ' + (d.error || `HTTP ${r.status}`) });
        setRedeeming(false);
        return;
      }
      setRedeemMsg({ ok: true, text: d.message });
      loadBalance();
    } catch (e: any) {
      setRedeemMsg({ ok: false, text: '❌ ' + e.message });
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <header className="sticky top-0 z-30 bg-[#0a0a0f]/95 backdrop-blur border-b border-white/5">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-white/60 hover:text-white text-sm">← 返回首页</Link>
          <h1 className="text-lg font-bold">💎 求片专区</h1>
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-sm font-medium"
          >
            📤 发布求片
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTab('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'all' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
          >
            🌐 全部求片
          </button>
          <button
            onClick={() => setTab('mine')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'mine' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
          >
            👤 我的求片
          </button>
          <button
            onClick={() => setTab('redeem')}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'redeem' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
          >
            💰 积分兑流明
          </button>
        </div>

        {/* 全部/我的求片 */}
        {(tab === 'all' || tab === 'mine') && (
          <>
            {loading ? (
              <div className="text-center text-white/40 py-12">加载中...</div>
            ) : error ? (
              <div className="text-red-400 text-sm">{error}</div>
            ) : items.length === 0 ? (
              <div className="text-center text-white/30 py-12 text-sm bg-white/5 rounded-lg">
                {tab === 'mine' ? '你还没发布过求片' : '暂无求片'}
              </div>
            ) : (
              <div className="space-y-2">
                {items.map(r => (
                  <div key={r.id} className="bg-white/5 rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="font-semibold text-sm">{r.title}</span>
                          {r.tmdbId && <span className="text-[10px] text-white/40">TMDB #{r.tmdbId} ({r.tmdbType})</span>}
                          <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 rounded text-[10px]">💎 {r.lumenCost}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            r.status === 'open' ? 'bg-cyan-500/20 text-cyan-300' :
                            r.status === 'claimed' ? 'bg-amber-500/20 text-amber-300' :
                            r.status === 'fulfilled' ? 'bg-emerald-500/20 text-emerald-300' :
                            'bg-white/10 text-white/40'
                          }`}>
                            {r.status === 'open' ? '待接单' : r.status === 'claimed' ? '已接单' : r.status === 'fulfilled' ? '✓ 已完成' : '已取消'}
                          </span>
                        </div>
                        {r.reason && <div className="text-xs text-white/60 mb-1">📝 {r.reason}</div>}
                        <div className="text-[10px] text-white/40">
                          👤 {r.username} · {new Date(r.createdAt).toLocaleString('zh-CN')}
                        </div>
                      </div>
                      {tab === 'all' && r.status === 'open' && (
                        <button
                          onClick={() => claim(r.id)}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 rounded text-xs font-medium flex-shrink-0"
                        >
                          接单
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 积分兑流明 */}
        {tab === 'redeem' && (
          <div className="bg-white/5 rounded-lg p-6 max-w-md mx-auto">
            <div className="text-center mb-6">
              <div className="text-xs text-white/40 mb-1">当前余额</div>
              <div className="flex items-center justify-center gap-6">
                <div>
                  <div className="text-2xl font-bold text-amber-300 flex items-center gap-1">
                    <Coins size={20} /> {points}
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">积分</div>
                </div>
                <div className="text-white/30">→</div>
                <div>
                  <div className="text-2xl font-bold text-cyan-300 flex items-center gap-1">
                    <Sparkles size={20} /> {lumen}
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">流明</div>
                </div>
              </div>
            </div>

            <div className="text-sm text-white/60 text-center mb-4">
              兑换比例: <span className="text-cyan-300 font-bold">10 积分 = 1 流明</span>
            </div>

            <div className="mb-4">
              <label className="text-xs text-white/60">兑换积分 (10 的倍数)</label>
              <input
                type="number"
                min="10"
                step="10"
                value={redeemAmount}
                onChange={e => setRedeemAmount(parseInt(e.target.value) || 0)}
                className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
              />
              <div className="text-[10px] text-white/40 mt-1 text-right">
                预计获得 <span className="text-cyan-300 font-bold">{Math.floor(redeemAmount / 10)}</span> 流明
              </div>
            </div>

            {redeemMsg && (
              <div className={`text-sm rounded px-3 py-2 mb-4 ${redeemMsg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                {redeemMsg.text}
              </div>
            )}

            <button
              onClick={doRedeem}
              disabled={redeeming || redeemAmount < 10 || redeemAmount % 10 !== 0 || points < redeemAmount}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-semibold text-sm"
            >
              {redeeming ? '兑换中...' : `兑换 ${redeemAmount} 积分 → ${Math.floor(redeemAmount / 10)} 流明`}
            </button>
          </div>
        )}
      </div>

      {/* 发布求片 modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setShowForm(false)}>
          <div className="bg-[#12121a] border border-white/10 rounded-xl p-5 max-w-md w-full" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-cyan-300">📤 发布求片</h3>
              <button onClick={() => setShowForm(false)} className="text-white/40 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-white/60">片名 *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  placeholder="例: 电影/剧名"
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-white/60">TMDB ID (可选)</label>
                  <input
                    type="number"
                    value={form.tmdbId}
                    onChange={e => setForm({ ...form, tmdbId: e.target.value })}
                    placeholder="例: 272"
                    className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
                  />
                </div>
                <div>
                  <label className="text-xs text-white/60">类型</label>
                  <select
                    value={form.tmdbType}
                    onChange={e => setForm({ ...form, tmdbType: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white"
                  >
                    <option value="movie" className="bg-[#12121a]">电影</option>
                    <option value="tv" className="bg-[#12121a]">剧集</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-white/60">理由 (可选)</label>
                <textarea
                  value={form.reason}
                  onChange={e => setForm({ ...form, reason: e.target.value })}
                  placeholder="例: 找了好久找不到"
                  maxLength={500}
                  rows={3}
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm text-white resize-none"
                />
              </div>

              <div>
                <label className="text-xs text-white/60">悬赏流明 (1-100)</label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={form.lumenCost}
                  onChange={e => setForm({ ...form, lumenCost: parseInt(e.target.value) })}
                  className="w-full mt-1"
                />
                <div className="flex justify-between text-[10px] text-white/40">
                  <span>1</span>
                  <span className="text-amber-300 font-bold text-base">{form.lumenCost} 流明</span>
                  <span>100</span>
                </div>
                <div className="text-[10px] text-white/40 mt-1 text-center">
                  (你当前有 <span className="text-cyan-300 font-bold">{lumen}</span> 流明)
                </div>
              </div>

              {submitMsg && (
                <div className={`text-sm rounded px-3 py-2 ${submitMsg.ok ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>
                  {submitMsg.text}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={submitRequest}
                  disabled={submitting || !form.title || lumen < form.lumenCost}
                  className="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-semibold text-sm"
                >
                  {submitting ? '发布中...' : `发布 (扣 ${form.lumenCost} 流明)`}
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
