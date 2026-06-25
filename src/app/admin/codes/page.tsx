'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Filter, RefreshCw, X, Check, Package, BarChart3 } from 'lucide-react';

interface Code {
  id: number;
  code: string;
  code_type: string;
  plan_id: string;
  duration: number;
  user_group: string;
  target_resource_id: number | null;
  target_resource_name: string | null;
  price_at_issue: number;
  lumen_amount: number;
  is_used: boolean;
  used_by: string | null;
  used_at: string | null;
  created_at: string;
  channel: string | null;
  batch_id: string | null;
  sent_to_customer: boolean;
  sent_at: string | null;
  sent_note: string | null;
}

interface BatchStat {
  channel: string;
  batch_id: string;
  plan_id: string;
  code_type: string;
  total: number;
  used: number;
}

const VIP_TEMPLATES = [
  { plan: 'vip_30d',     label: '30 天',   emoji: '🎫', price: 12,  color: 'from-sky-500 to-blue-600' },
  { plan: 'vip_180d',    label: '半年',    emoji: '🎟️', price: 58,  color: 'from-violet-500 to-purple-600' },
  { plan: 'vip_365d',    label: '年卡',    emoji: '🎁', price: 98,  color: 'from-pink-500 to-rose-600' },
  { plan: 'vip_forever', label: '永久',    emoji: '👑', price: 198, color: 'from-amber-500 to-orange-600' },
  { plan: 'unlock',      label: '单资源',  emoji: '🔓', price: 0,   color: 'from-emerald-500 to-teal-600' },
  { plan: 'lumen',       label: '流明',    emoji: '💎', price: 0,   color: 'from-fuchsia-500 to-pink-600' },
];

const CHANNELS = [
  { value: 'xy', label: '闲鱼', emoji: '🐟' },
  { value: 'wd', label: '微店', emoji: '🏪' },
];

export default function CodesPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [batchStats, setBatchStats] = useState<BatchStat[]>([]);
  const [loading, setLoading] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);

  // 筛选
  const [fChannel, setFChannel] = useState('');
  const [fCodeType, setFCodeType] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fBatch, setFBatch] = useState('');
  const [fSent, setFSent] = useState(''); // '' / 'sent' / 'unsent'
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [sentNote, setSentNote] = useState('');

  // 生成器
  const [genPlan, setGenPlan] = useState('vip_180d');
  const [genChannel, setGenChannel] = useState('xy');
  const [genCount, setGenCount] = useState(10);
  const [genBatch, setGenBatch] = useState('');
  const [genLumenAmount, setGenLumenAmount] = useState(50);  // 流明数量
  const [genResourceId, setGenResourceId] = useState<number | null>(null);  // 单资源 ID
  const [genResourceName, setGenResourceName] = useState('');  // 单资源名称（前端缓存）
  const [resourceSearch, setResourceSearch] = useState('');
  const [resourceResults, setResourceResults] = useState<{ id: number; name: string; category: string }[]>([]);
  const [genResult, setGenResult] = useState<{ codes: string[]; plan: string; channel: string; batch_id: string; price: number; lumen_amount?: number } | null>(null);
  const [toast, setToast] = useState('');

  // token 鉴权
  useEffect(() => {
    const t = typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || '') : '';
    if (t) { setToken(t); setAuthed(true); }
  }, []);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 2000); };

  const fetchList = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '200' });
      if (fChannel) params.set('channel', fChannel);
      if (fCodeType) params.set('code_type', fCodeType);
      if (fStatus) params.set('status', fStatus);
      if (fBatch) params.set('batch_id', fBatch);
      const r = await fetch('/api/admin/codes?' + params, { headers: { Authorization: 'Bearer ' + token } });
      let d = await r.json();
      if (d.error) showToast('❌ ' + d.error);
      else {
        let items = d.items || [];
        // sent 过滤 (前端, 因为后端没加)
        if (fSent === 'sent') items = items.filter((c: Code) => c.sent_to_customer);
        else if (fSent === 'unsent') items = items.filter((c: Code) => !c.sent_to_customer);
        setCodes(items);
        setBatchStats(d.batch_stats || []);
      }
    } catch (e: any) { showToast('❌ ' + e.message); }
    finally { setLoading(false); }
  }, [token, fChannel, fCodeType, fStatus, fBatch, fSent]);

  useEffect(() => { if (authed) fetchList(); }, [authed, fetchList]);

  const handleGen = async () => {
    if (!token) { showToast('❌ 请先登录'); return; }
    if (genCount < 1 || genCount > 200) { showToast('❌ 数量 1-200'); return; }
    if (genPlan === 'unlock' && !genResourceId) { showToast('❌ 请先选择目标资源'); return; }
    if (genPlan === 'lumen' && (!genLumenAmount || genLumenAmount < 1)) { showToast('❌ 流明数量必须 ≥ 1'); return; }
    setGenLoading(true);
    try {
      const body: any = { plan: genPlan, channel: genChannel, count: genCount, batch_id: genBatch || undefined };
      if (genPlan === 'unlock') body.target_resource_id = genResourceId;
      if (genPlan === 'lumen') body.lumen_amount = genLumenAmount;
      const r = await fetch('/api/admin/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (d.error) showToast('❌ ' + d.error);
      else {
        setGenResult({ codes: d.codes, plan: d.plan, channel: d.channel, batch_id: d.batch_id, price: d.price_at_issue, lumen_amount: d.lumen_amount });
        showToast(`✅ 生成 ${d.codes.length} 个 ${d.channel_label}激活码`);
        setGenBatch('');
        fetchList();
      }
    } catch (e: any) { showToast('❌ ' + e.message); }
    finally { setGenLoading(false); }
  };

  // 单资源搜索 (防抖)
  useEffect(() => {
    if (genPlan !== 'unlock') return;
    if (!resourceSearch.trim()) { setResourceResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(resourceSearch)}&pageSize=10`, { headers: { Authorization: 'Bearer ' + token } });
        const d = await r.json();
        setResourceResults((d.items || []).slice(0, 10));
      } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [resourceSearch, genPlan, token]);

  const copyText = async (text: string, msg = '已复制') => {
    try { await navigator.clipboard.writeText(text); showToast('✅ ' + msg); } catch { showToast('❌ 复制失败'); }
  };

  const markSent = async (ids: number[], sent: boolean, note?: string) => {
    if (!ids.length) return;
    const r = await fetch('/api/admin/codes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ ids, sent_to_customer: sent, sent_note: note || null }),
    });
    const d = await r.json();
    if (d.error) showToast('❌ ' + d.error);
    else { showToast(`✅ 已标记 ${ids.length} 个`); setSelectedIds([]); setSentNote(''); fetchList(); }
  };

  const copyAll = () => {
    if (!genResult) return;
    copyText(genResult.codes.join('\n'), `已复制 ${genResult.codes.length} 个码`);
  };

  // 复制后自动标记本次生成的码为"已发" (防重发)
  const copyAllAndMarkSent = async () => {
    if (!genResult) return;
    copyText(genResult.codes.join('\n'), `已复制并标记 ${genResult.codes.length} 个为已发`);
    // 找到刚生成的码对应的 id, 标记为已发
    const ids = codes.filter(c => genResult.codes.includes(c.code)).map(c => c.id);
    if (ids.length) await markSent(ids, true, `批次 ${genResult.batch_id} 复制即发`);
  };

  const copyAsProduct = () => {
    if (!genResult) return;
    const planLabel = VIP_TEMPLATES.find(t => t.plan === genResult.plan)?.label || 'VIP';
    const chLabel = genResult.channel === 'wd' ? '微店' : '闲鱼';
    const text = genResult.codes.map(c => `[${chLabel}VIP${planLabel}] 激活码: ${c}`).join('\n');
    copyText(text, `已复制 ${genResult.codes.length} 条商品格式`);
  };

  const exportCSV = () => {
    if (!genResult) return;
    const planLabel = VIP_TEMPLATES.find(t => t.plan === genResult.plan)?.label || 'VIP';
    const chLabel = genResult.channel === 'wd' ? '微店' : '闲鱼';
    const csv = '\uFEFF商品,激活码,批次\n' + genResult.codes.map(c => `${chLabel}VIP${planLabel},${c},${genResult.batch_id}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `codes_${genResult.batch_id}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const total = batchStats.reduce((s, b) => s + b.total, 0);
    const used = batchStats.reduce((s, b) => s + b.used, 0);
    return { total, used, unused: total - used };
  }, [batchStats]);

  // 登录界面 - 由 /admin/layout.tsx 统一处理
  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">🎫 激活码管理</h1>
          <button onClick={() => { localStorage.removeItem('zzmm_token'); setAuthed(false); setToken(''); }} className="text-sm text-white/40 hover:text-white/60">
            退出登录
          </button>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">总生成</div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">已使用</div>
            <div className="text-2xl font-bold mt-1 text-emerald-400">{stats.used}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">未使用</div>
            <div className="text-2xl font-bold mt-1 text-amber-400">{stats.unused}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-4 border border-white/5">
            <div className="text-xs text-white/40">使用率</div>
            <div className="text-2xl font-bold mt-1 text-violet-400">{stats.total > 0 ? Math.round(stats.used / stats.total * 100) : 0}%</div>
          </div>
        </div>

        {/* 生成器 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-violet-400" /> 快速生成
          </h2>

          {/* 模板按钮 */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
            {VIP_TEMPLATES.map(t => (
              <button
                key={t.plan}
                onClick={() => setGenPlan(t.plan)}
                className={`p-4 rounded-xl border transition ${
                  genPlan === t.plan
                    ? `bg-gradient-to-br ${t.color} border-transparent shadow-lg`
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                <div className="text-2xl mb-1">{t.emoji}</div>
                <div className="font-semibold text-sm">{t.plan.startsWith('vip') ? `VIP ${t.label}` : t.label}</div>
                <div className="text-xs text-white/60 mt-1">{t.price > 0 ? `¥${t.price}` : (t.plan === 'lumen' ? '流明数自定义' : '单资源指定')}</div>
              </button>
            ))}
          </div>

          {/* 单资源选择器 (仅 unlock 模式) */}
          {genPlan === 'unlock' && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <label className="block text-xs text-emerald-300 mb-1.5">目标资源（必须 pay_type=code）</label>
              {genResourceId ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">#{genResourceId} · {genResourceName}</span>
                  <button onClick={() => { setGenResourceId(null); setGenResourceName(''); setResourceSearch(''); }} className="text-xs text-red-300 hover:underline">✕ 清除</button>
                </div>
              ) : (
                <>
                  <input value={resourceSearch} onChange={e => setResourceSearch(e.target.value)} placeholder="搜资源名（中文/拼音）" className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm" />
                  {resourceResults.length > 0 && (
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
                      {resourceResults.map(r => (
                        <button key={r.id} onClick={() => { setGenResourceId(r.id); setGenResourceName(r.name); setResourceSearch(''); }} className="w-full text-left px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded text-sm">
                          <span className="text-emerald-300">#{r.id}</span> · {r.name} <span className="text-xs text-white/40 ml-1">[{r.category}]</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 流明数输入 (仅 lumen 模式) */}
          {genPlan === 'lumen' && (
            <div className="mb-4 p-3 bg-fuchsia-500/10 border border-fuchsia-500/30 rounded-xl">
              <label className="block text-xs text-fuchsia-300 mb-1.5">每个码充值流明数</label>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={100000} value={genLumenAmount} onChange={e => setGenLumenAmount(parseInt(e.target.value) || 0)} className="w-32 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm font-mono" />
                <span className="text-sm text-white/60">💎 流明</span>
                <span className="text-xs text-white/40">建议: 50/100/200/500 (¥{genLumenAmount > 0 ? `约 ${genLumenAmount * 0.1}` : '?'})</span>
              </div>
            </div>
          )}

          {/* 渠道 + 数量 + 批次 */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="block text-xs text-white/60 mb-1.5">销售渠道</label>
              <div className="flex gap-2">
                {CHANNELS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setGenChannel(c.value)}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${
                      genChannel === c.value ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
                    }`}
                  >
                    {c.emoji} {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-white/60 mb-1.5">数量</label>
              <input
                type="number" min={1} max={200}
                value={genCount}
                onChange={e => setGenCount(parseInt(e.target.value) || 1)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-white/60 mb-1.5">批次名（留空自动生成）</label>
              <input
                value={genBatch}
                onChange={e => setGenBatch(e.target.value)}
                placeholder="例: 20260609-XY-180D"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>

          <button
            onClick={handleGen}
            disabled={genLoading || (genPlan === 'unlock' && !genResourceId)}
            className="w-full py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium hover:opacity-90 disabled:opacity-50"
          >
            {genLoading ? '生成中...' : `🎟️ 生成 ${genCount} 个 ${genPlan === 'unlock' ? '单资源' : genPlan === 'lumen' ? '流明' : (VIP_TEMPLATES.find(t => t.plan === genPlan)?.label || '')}激活码`}
          </button>

          {/* 生成结果 */}
          {genResult && (
            <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <div className="text-sm">
                  <span className="text-emerald-400 font-semibold">✅ 已生成 {genResult.codes.length} 个</span>
                  <span className="text-white/60 ml-2">批次: <code className="text-violet-300">{genResult.batch_id}</code></span>
                  <span className="text-white/60 ml-2">¥{genResult.price}/个</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={copyAll} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 纯码
                  </button>
                  <button onClick={copyAsProduct} className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 商品格式
                  </button>
                  <button onClick={copyAllAndMarkSent} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs flex items-center gap-1">
                    <Copy className="w-3 h-3" /> 复制并标记已发
                  </button>
                  <button onClick={exportCSV} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-xs flex items-center gap-1">
                    <Download className="w-3 h-3" /> CSV
                  </button>
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto bg-black/30 rounded-lg p-3 font-mono text-xs space-y-0.5">
                {genResult.codes.map(c => (
                  <div key={c} className="text-violet-300 cursor-pointer hover:text-violet-200" onClick={() => copyText(c)}>
                    {c}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 批次统计 */}
        {batchStats.length > 0 && (
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-400" /> 批次统计
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-white/40 text-xs border-b border-white/5">
                    <th className="py-2 px-2">渠道</th>
                    <th className="py-2 px-2">批次</th>
                    <th className="py-2 px-2">套餐</th>
                    <th className="py-2 px-2">类型</th>
                    <th className="py-2 px-2">总数</th>
                    <th className="py-2 px-2">已用</th>
                    <th className="py-2 px-2">未用</th>
                    <th className="py-2 px-2">使用率</th>
                  </tr>
                </thead>
                <tbody>
                  {batchStats.map((b, i) => (
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 px-2">{b.channel === 'wd' ? '🏪' : '🐟'}</td>
                      <td className="py-2 px-2 font-mono text-violet-300">{b.batch_id}</td>
                      <td className="py-2 px-2">{b.plan_id}</td>
                      <td className="py-2 px-2">{b.code_type}</td>
                      <td className="py-2 px-2 font-semibold">{b.total}</td>
                      <td className="py-2 px-2 text-emerald-400">{b.used}</td>
                      <td className="py-2 px-2 text-amber-400">{b.total - b.used}</td>
                      <td className="py-2 px-2">{b.total > 0 ? Math.round(b.used / b.total * 100) : 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 列表筛选 + 明细 */}
        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Filter className="w-5 h-5 text-amber-400" /> 激活码明细（共 {codes.length} 条）
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIds.length > 0 && (
                <>
                  <span className="text-sm text-violet-300">已选 {selectedIds.length} 个</span>
                  <input value={sentNote} onChange={e => setSentNote(e.target.value)} placeholder="备注(可选)" className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs w-32" />
                  <button onClick={() => markSent(selectedIds, true, sentNote)} className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-xs">📦 标记已发</button>
                  <button onClick={() => markSent(selectedIds, false)} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">↩️ 取消已发</button>
                </>
              )}
              <button onClick={fetchList} disabled={loading} className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm flex items-center gap-1">
                <RefreshCw className={'w-3 h-3 ' + (loading ? 'animate-spin' : '')} /> 刷新
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <select value={fChannel} onChange={e => setFChannel(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">全部渠道</option>
              <option value="xy">🐟 闲鱼</option>
              <option value="wd">🏪 微店</option>
            </select>
            <select value={fCodeType} onChange={e => setFCodeType(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">全部类型</option>
              <option value="vip">🎫 VIP 会员</option>
              <option value="unlock">🔓 单资源</option>
              <option value="lumen">💎 流明</option>
            </select>
            <select value={fStatus} onChange={e => setFStatus(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">全部状态</option>
              <option value="unused">未使用</option>
              <option value="used">已使用</option>
            </select>
            <select value={fSent} onChange={e => setFSent(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="">全部发货</option>
              <option value="sent">📦 已发</option>
              <option value="unsent">⏳ 未发</option>
            </select>
            <input value={fBatch} onChange={e => setFBatch(e.target.value)} placeholder="批次名筛选" className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-[#12121a]">
                <tr className="text-left text-white/40 text-xs border-b border-white/10">
                  <th className="py-2 px-2 w-8">
                    <input type="checkbox" checked={selectedIds.length === codes.length && codes.length > 0} onChange={e => setSelectedIds(e.target.checked ? codes.map(c => c.id) : [])} />
                  </th>
                  <th className="py-2 px-2">激活码</th>
                  <th className="py-2 px-2">类型</th>
                  <th className="py-2 px-2">渠道</th>
                  <th className="py-2 px-2">批次</th>
                  <th className="py-2 px-2">使用</th>
                  <th className="py-2 px-2">发货</th>
                  <th className="py-2 px-2">价格</th>
                </tr>
              </thead>
              <tbody>
                {codes.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-white/40">暂无数据</td></tr>
                ) : codes.map(c => (
                  <tr key={c.id} className={`border-b border-white/5 hover:bg-white/5 ${c.sent_to_customer ? 'opacity-60' : ''}`}>
                    <td className="py-2 px-2">
                      <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={e => setSelectedIds(e.target.checked ? [...selectedIds, c.id] : selectedIds.filter(x => x !== c.id))} />
                    </td>
                    <td className="py-2 px-2 font-mono text-violet-300 cursor-pointer" onClick={() => copyText(c.code)}>
                      {c.code}
                    </td>
                    <td className="py-2 px-2 text-xs">{c.code_type === 'vip' ? (c.plan_id || `VIP ${c.duration}天`) : c.code_type === 'lumen' ? `💎 ${c.lumen_amount || 0} 流明` : (c.target_resource_name?.slice(0, 15) || `#${c.target_resource_id}`)}</td>
                    <td className="py-2 px-2">{c.channel === 'wd' ? '🏪' : c.channel === 'xy' ? '🐟' : '-'}</td>
                    <td className="py-2 px-2 font-mono text-xs text-white/60">{c.batch_id || '-'}</td>
                    <td className="py-2 px-2">
                      {c.is_used
                        ? <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded text-xs">已用</span>
                        : <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">未用</span>
                      }
                    </td>
                    <td className="py-2 px-2">
                      {c.sent_to_customer
                        ? <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 rounded text-xs" title={c.sent_note || ''}>📦 {c.sent_at ? new Date(c.sent_at).toLocaleDateString('zh-CN').slice(5) : '已发'}</span>
                        : <span className="px-2 py-0.5 bg-white/5 text-white/40 rounded text-xs">⏳</span>
                      }
                    </td>
                    <td className="py-2 px-2 text-xs">¥{c.price_at_issue || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 right-6 px-4 py-3 bg-violet-600 text-white rounded-xl shadow-lg text-sm z-50"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
