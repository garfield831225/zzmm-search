'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

type Tab = 'list' | 'mine' | 'create';
type Status = 'pending' | 'claimed' | 'submitted' | 'confirmed' | 'cancelled';

interface Bounty {
  id: number;
  title: string;
  description: string;
  reward: number;
  creator_id: number;
  claimer_id: number | null;
  status: Status;
  submission: string | null;
  submission_url: string | null;
  created_at: string;
  claimed_at: string | null;
  submitted_at: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  creator_name?: string;
  claimer_name?: string;
}

const STATUS_LABEL: Record<Status, string> = {
  pending: '待接单',
  claimed: '已接单',
  submitted: '已交稿',
  confirmed: '已验收',
  cancelled: '已取消',
};

const STATUS_COLOR: Record<Status, string> = {
  pending: 'text-yellow-400 bg-yellow-900/30',
  claimed: 'text-blue-400 bg-blue-900/30',
  submitted: 'text-purple-400 bg-purple-900/30',
  confirmed: 'text-green-400 bg-green-900/30',
  cancelled: 'text-zinc-400 bg-zinc-800',
};

export default function BountyPage() {
  const [tab, setTab] = useState<Tab>('list');
  const [status, setStatus] = useState<Status>('pending');
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [lumenBalance, setLumenBalance] = useState<number>(0);
  const [token, setToken] = useState<string>('');

  // 发单表单
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createReward, setCreateReward] = useState(100);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<any>(null);

  // 接单弹窗
  const [claimModal, setClaimModal] = useState<Bounty | null>(null);
  const [submitModal, setSubmitModal] = useState<Bounty | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [submissionUrl, setSubmissionUrl] = useState('');

  useEffect(() => {
    // 读 cookie 拿 token
    const cookieToken = document.cookie.split('; ').find(r => r.startsWith('zzmm_token='))?.split('=')[1];
    if (cookieToken) {
      setToken(cookieToken);
      try {
        const payload = JSON.parse(atob(cookieToken.split('.')[1] || ''));
        setUserId(Number(payload.id) || null);
      } catch {}
    }
  }, []);

  useEffect(() => {
    fetchBounties();
  }, [status, tab]);

  const fetchBounties = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/bounty/list?status=${status}&mine=${tab === 'mine'}&limit=50`);
      const j = await r.json();
      if (j.ok) setBounties(j.items || []);
    } finally {
      setLoading(false);
    }
  };

  const fetchBalance = async () => {
    if (!token) return;
    const r = await fetch('/api/user/balance', { headers: { 'Authorization': 'Bearer ' + token } });
    const j = await r.json();
    if (j.ok) setLumenBalance(j.balance || 0);
  };

  useEffect(() => { if (token) fetchBalance(); }, [token]);

  const createBounty = async () => {
    if (!token) { setCreateResult({ ok: false, error: '请先登录' }); return; }
    if (!createTitle.trim() || !createDesc.trim()) { setCreateResult({ ok: false, error: '请填标题和描述' }); return; }
    if (createReward < 10) { setCreateResult({ ok: false, error: '至少 10 流明' }); return; }
    if (lumenBalance < createReward) { setCreateResult({ ok: false, error: `余额不足 (当前 ${lumenBalance})` }); return; }
    setCreating(true);
    setCreateResult(null);
    try {
      const r = await fetch('/api/bounty/create', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: createTitle, description: createDesc, reward: createReward }),
      });
      const j = await r.json();
      setCreateResult(j);
      if (j.ok) {
        setCreateTitle('');
        setCreateDesc('');
        setCreateReward(100);
        setLumenBalance(j.new_balance || 0);
        setTab('mine');
        setStatus('pending');
        fetchBounties();
      }
    } finally {
      setCreating(false);
    }
  };

  const claimBounty = async (b: Bounty) => {
    if (!token) { alert('请先登录'); return; }
    if (b.creator_id === userId) { alert('不能接自己的单'); return; }
    const r = await fetch('/api/bounty/claim', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty_id: b.id }),
    });
    const j = await r.json();
    alert(j.ok ? '✓ 抢单成功' : '✗ ' + (j.error || '失败'));
    setClaimModal(null);
    fetchBounties();
  };

  const submitBounty = async () => {
    if (!submitModal || !submissionText.trim()) { alert('请填交付说明'); return; }
    const r = await fetch('/api/bounty/submit', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty_id: submitModal.id, submission: submissionText, submission_url: submissionUrl }),
    });
    const j = await r.json();
    alert(j.ok ? '✓ 已交稿, 等发单者验收' : '✗ ' + (j.error || '失败'));
    setSubmitModal(null);
    setSubmissionText('');
    setSubmissionUrl('');
    fetchBounties();
  };

  const confirmBounty = async (b: Bounty) => {
    if (!confirm(`确认验收? ${b.reward} 流明将给接单者 (0% 抽成)`)) return;
    const r = await fetch('/api/bounty/confirm', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty_id: b.id }),
    });
    const j = await r.json();
    alert(j.ok ? '✓ 验收成功' : '✗ ' + (j.error || '失败'));
    fetchBounties();
  };

  const cancelBounty = async (b: Bounty) => {
    if (!confirm(`确认撤单? ${b.reward} 流明将退回`)) return;
    const r = await fetch('/api/bounty/cancel', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ bounty_id: b.id }),
    });
    const j = await r.json();
    alert(j.ok ? `✓ 撤单成功, 退回 ${j.refund} 流明` : '✗ ' + (j.error || '失败'));
    fetchBounties();
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">💎 悬赏专区</h1>
          <div className="text-sm text-zinc-400">
            我的流明: <span className="text-yellow-400 font-bold">{lumenBalance}</span>
          </div>
        </div>
        <p className="text-zinc-400 mb-6 text-sm">
          0% 抽成 · 押 100% / 退 100% / 完成 100% 给接单者 · 泽泽妈妈找资源, 你来赚钱
        </p>

        {/* 标签 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['list', 'mine', 'create'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded text-sm ${tab === t ? 'bg-indigo-600' : 'bg-zinc-800 hover:bg-zinc-700'}`}
            >
              {t === 'list' && '🟡 全部悬赏'}
              {t === 'mine' && '👤 我的悬赏'}
              {t === 'create' && '➕ 发悬赏'}
            </button>
          ))}
        </div>

        {tab !== 'create' && (
          <div className="flex gap-2 mb-4 flex-wrap">
            {(['pending', 'claimed', 'submitted', 'confirmed', 'cancelled'] as Status[]).map(s => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded text-xs ${status === s ? 'bg-zinc-700' : 'bg-zinc-800/50 hover:bg-zinc-800'}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}

        {/* 发单表单 */}
        {tab === 'create' && (
          <div className="bg-zinc-900 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">发新悬赏</h2>
            <input
              type="text"
              value={createTitle}
              onChange={e => setCreateTitle(e.target.value)}
              placeholder="悬赏标题 (简短)"
              maxLength={100}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded mb-3"
            />
            <textarea
              value={createDesc}
              onChange={e => setCreateDesc(e.target.value)}
              placeholder="详细描述 (要求/规格/链接等)"
              rows={5}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded mb-3"
            />
            <div className="flex items-center gap-3 mb-3">
              <label className="text-sm text-zinc-400">奖励流明:</label>
              <input
                type="number"
                value={createReward}
                onChange={e => setCreateReward(Math.max(10, Number(e.target.value) || 0))}
                min={10}
                max={100000}
                className="w-32 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded"
              />
              <span className="text-xs text-zinc-500">(10-100000)</span>
            </div>
            <button
              onClick={createBounty}
              disabled={creating}
              className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded font-semibold"
            >
              {creating ? '发布中...' : `🚀 押 ${createReward} 流明 发单`}
            </button>
            {createResult && (
              <div className={`mt-3 p-3 rounded text-sm ${createResult.ok ? 'bg-green-900/30' : 'bg-red-900/30'}`}>
                {createResult.ok ? '✓ ' + createResult.message : '✗ ' + (createResult.error || '失败')}
              </div>
            )}
          </div>
        )}

        {/* 列表 */}
        {tab !== 'create' && (
          <div>
            {loading ? <div className="text-zinc-400 text-center py-8">加载中...</div> : bounties.length === 0 ? (
              <div className="text-zinc-500 text-center py-8">暂无{STATUS_LABEL[status]}的悬赏</div>
            ) : (
              bounties.map(b => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900 rounded-lg p-5 mb-3"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-yellow-400 font-bold text-lg">💎 {b.reward}</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLOR[b.status]}`}>{STATUS_LABEL[b.status]}</span>
                      </div>
                      <h3 className="font-semibold mb-1">#{b.id} {b.title}</h3>
                      <p className="text-sm text-zinc-400 whitespace-pre-wrap">{b.description}</p>
                      {b.submission && (
                        <div className="mt-2 p-2 bg-zinc-800 rounded text-xs">
                          <div className="text-zinc-500 mb-1">接单者交付:</div>
                          <div className="whitespace-pre-wrap">{b.submission}</div>
                          {b.submission_url && <a href={b.submission_url} target="_blank" className="text-indigo-400 hover:underline">{b.submission_url}</a>}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-500 mt-3">
                    <div>
                      发单: {b.creator_name || `#${b.creator_id}`}
                      {b.claimer_name && ` · 接单: ${b.claimer_name}`}
                      {b.claimer_id && !b.claimer_name && ` · 接单: #${b.claimer_id}`}
                    </div>
                    <div>{new Date(b.created_at).toLocaleString('zh-CN')}</div>
                  </div>
                  {/* 操作按钮 */}
                  {token && (
                    <div className="flex gap-2 mt-3">
                      {b.status === 'pending' && b.creator_id !== userId && (
                        <button onClick={() => setClaimModal(b)} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm">🛒 抢单</button>
                      )}
                      {b.status === 'pending' && b.creator_id === userId && (
                        <button onClick={() => cancelBounty(b)} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-sm">撤单</button>
                      )}
                      {b.status === 'claimed' && b.claimer_id === userId && (
                        <button onClick={() => setSubmitModal(b)} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 rounded text-sm">📤 交稿</button>
                      )}
                      {b.status === 'submitted' && b.creator_id === userId && (
                        <button onClick={() => confirmBounty(b)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 rounded text-sm">✓ 验收</button>
                      )}
                    </div>
                  )}
                </motion.div>
              ))
            )}
          </div>
        )}

        {/* 接单弹窗 */}
        {claimModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setClaimModal(null)}>
            <div className="bg-zinc-900 rounded-lg p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-semibold mb-3">抢单 #{claimModal.id}</h3>
              <p className="text-sm text-zinc-400 mb-4">奖励 <span className="text-yellow-400 font-bold">💎 {claimModal.reward}</span> 流明</p>
              <p className="text-sm mb-4">{claimModal.title}</p>
              <div className="flex gap-2">
                <button onClick={() => claimBounty(claimModal)} className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded">确认抢单</button>
                <button onClick={() => setClaimModal(null)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded">取消</button>
              </div>
            </div>
          </div>
        )}

        {/* 交稿弹窗 */}
        {submitModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setSubmitModal(null)}>
            <div className="bg-zinc-900 rounded-lg p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <h3 className="text-xl font-semibold mb-3">交稿 #{submitModal.id}</h3>
              <textarea
                value={submissionText}
                onChange={e => setSubmissionText(e.target.value)}
                placeholder="交付说明 (必填)"
                rows={4}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded mb-3"
              />
              <input
                type="url"
                value={submissionUrl}
                onChange={e => setSubmissionUrl(e.target.value)}
                placeholder="交付链接 (可选)"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded mb-3"
              />
              <div className="flex gap-2">
                <button onClick={submitBounty} className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded">提交</button>
                <button onClick={() => setSubmitModal(null)} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded">取消</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
