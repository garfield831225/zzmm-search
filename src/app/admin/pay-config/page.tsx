'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Search, Settings, Lock, Unlock, Copy, X, Plus, ChevronRight, Film, Tv, Music, Disc, Sparkles } from 'lucide-react';

interface Item {
  id: number;
  name: string;
  category: string;
  pay_type: string;
  code_price: number;
  tmdb_id: string;
  source: string;
  poster_path: string;
}

interface CategoryStat {
  category: string;
  total: number;
  code_count: number;
}

const CAT_ICONS: Record<string, string> = {
  '电影': '🎬', '剧集': '📺', '动漫': '🎨', '综艺': '🎉', '纪录片': '📚',
  '演唱会': '🎤', '音乐': '🎵', '体育': '⚽', '原盘': '💿', 'REMUX': '🔰',
  '系列电影': '📀', '合集': '📦', '连载': '⏳', '少儿频道': '🧒',
};

export default function PayConfigPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [payType, setPayType] = useState('');  // '' = 全部, 'free', 'code'
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [editing, setEditing] = useState<Item | null>(null);
  const [newPayType, setNewPayType] = useState('free');
  const [newPrice, setNewPrice] = useState(0);
  const [generating, setGenerating] = useState<Item | null>(null);
  const [genCount, setGenCount] = useState(1);
  const [genPrice, setGenPrice] = useState(0);
  const [genResult, setGenResult] = useState<{ codes: string[]; resource_name: string; price: number } | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || '';
    setToken(t);
  }, []);

  const showToast = (type: 'success' | 'error', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 2200);
  };

  // 加载当前类别 + 搜索条件的资源
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '500' });
      if (search.trim()) params.set('q', search.trim());
      if (payType) params.set('pay_type', payType);
      const r = await fetch(`/api/admin/pay-config?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) showToast('error', data.error);
      else setItems(data.items || []);
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token, search, payType]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // 按 category 分组
  const grouped = useMemo(() => {
    const g: Record<string, Item[]> = {};
    for (const it of items) {
      if (!g[it.category]) g[it.category] = [];
      g[it.category].push(it);
    }
    return g;
  }, [items]);

  // 类别统计（基于当前搜索结果 + pay_type 过滤，但忽略类别选择）
  const categoryStats = useMemo<CategoryStat[]>(() => {
    const stats: Record<string, CategoryStat> = {};
    for (const it of items) {
      if (!stats[it.category]) stats[it.category] = { category: it.category, total: 0, code_count: 0 };
      stats[it.category].total++;
      if (it.pay_type === 'code') stats[it.category].code_count++;
    }
    return Object.values(stats).sort((a, b) => b.total - a.total);
  }, [items]);

  // 总计
  const totalStats = useMemo(() => {
    let total = 0, codeCount = 0;
    for (const it of items) {
      total++;
      if (it.pay_type === 'code') codeCount++;
    }
    return { total, codeCount };
  }, [items]);

  // 当前显示的资源列表
  const displayItems = useMemo(() => {
    if (!selectedCategory) return items.slice(0, 50);  // 选 "全部" 显示前 50
    return grouped[selectedCategory] || [];
  }, [items, grouped, selectedCategory]);

  const handleSave = async () => {
    if (!editing || !token) return;
    try {
      const r = await fetch('/api/admin/pay-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id: editing.id, pay_type: newPayType, code_price: newPrice }),
      });
      const data = await r.json();
      if (data.success) {
        showToast('success', '✅ 已保存');
        setEditing(null);
        load();
      } else {
        showToast('error', data.error || '失败');
      }
    } catch (e: any) { showToast('error', e.message); }
  };

  const handleBatchSet = async (ids: number[], pay_type: string, price: number) => {
    if (!ids.length || !token) return;
    if (!confirm(`确认将 ${ids.length} 个资源设置为 ${pay_type === 'code' ? `付费 ¥${price}` : '免费'}？`)) return;
    try {
      // 并行调 API
      const promises = ids.map(id =>
        fetch('/api/admin/pay-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, pay_type, code_price: price }),
        }).then(r => r.json())
      );
      const results = await Promise.all(promises);
      const okCount = results.filter(r => r.success).length;
      showToast('success', `✅ 批量设置 ${okCount}/${ids.length} 个`);
      load();
    } catch (e: any) { showToast('error', e.message); }
  };

  const handleGenerate = async () => {
    if (!generating || !token) return;
    try {
      const r = await fetch('/api/admin/codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          count: genCount,
          target_resource_id: generating.id,
          price_at_issue: genPrice,
        }),
      });
      const data = await r.json();
      if (data.codes) {
        setGenResult({ codes: data.codes, resource_name: data.target_resource_name || generating.name, price: data.price_at_issue });
        showToast('success', `✅ 生成 ${data.codes.length} 个码`);
        load();
      } else {
        showToast('error', data.error || '失败');
      }
    } catch (e: any) { showToast('error', e.message); }
  };

  const copyCodes = async () => {
    if (!genResult) return;
    await navigator.clipboard.writeText(genResult.codes.join('\n'));
    showToast('success', `✅ 已复制 ${genResult.codes.length} 个码`);
  };

  // 类别批量操作 state
  const [batchPrice, setBatchPrice] = useState(5);
  const [batchPayType, setBatchPayType] = useState<'code' | 'free'>('code');

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/admin')} className="p-2 hover:bg-white/10 rounded-lg">←</button>
          <h1 className="text-2xl font-bold">💰 单资源付费配置</h1>
          <a href="/admin/codes" className="ml-auto text-sm text-violet-400 hover:underline">查看激活码 →</a>
        </div>

        {/* 搜索栏 */}
        <div className="flex gap-2 mb-4 flex-wrap bg-[#12121a] rounded-2xl p-3 border border-white/5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="按名称搜索资源（输入后回车）..."
              className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-white placeholder-white/40 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <select value={payType} onChange={e => { setPayType(e.target.value); }}
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm">
            <option value="">全部付费类型</option>
            <option value="free">免费</option>
            <option value="code">付费 (code)</option>
          </select>
          <button onClick={load} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm flex items-center gap-1">
            <Search className="w-3 h-3" /> 搜索
          </button>
          <button onClick={() => { setSearch(''); setPayType(''); setSelectedCategory(''); }} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
            <X className="w-3 h-3" /> 清空
          </button>
        </div>

        {/* 总览统计 */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-[#12121a] rounded-xl p-3 border border-white/5">
            <div className="text-xs text-white/40">当前查询总数</div>
            <div className="text-xl font-bold mt-0.5">{totalStats.total.toLocaleString()}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-3 border border-yellow-500/20">
            <div className="text-xs text-yellow-300/80">已设置付费</div>
            <div className="text-xl font-bold mt-0.5 text-yellow-300">{totalStats.codeCount}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-3 border border-emerald-500/20">
            <div className="text-xs text-emerald-300/80">免费资源</div>
            <div className="text-xl font-bold mt-0.5 text-emerald-300">{(totalStats.total - totalStats.codeCount).toLocaleString()}</div>
          </div>
        </div>

        {/* 主体: 左类别 + 右列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
          {/* 左侧: 类别卡片 */}
          <div className="bg-[#12121a] rounded-2xl p-3 border border-white/5 max-h-[70vh] overflow-y-auto">
            <div className="text-xs text-white/40 mb-2 px-2 sticky top-0 bg-[#12121a] py-2">
              📁 类别 ({categoryStats.length})
            </div>
            <button
              onClick={() => setSelectedCategory('')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between mb-1 ${!selectedCategory ? 'bg-violet-600/30 border border-violet-500/40' : 'hover:bg-white/5 border border-transparent'}`}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                <span className="font-medium">全部</span>
              </span>
              <span className="text-xs text-white/40">{totalStats.total}</span>
            </button>
            {categoryStats.map(stat => (
              <button
                key={stat.category}
                onClick={() => setSelectedCategory(stat.category)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between mb-1 ${selectedCategory === stat.category ? 'bg-violet-600/30 border border-violet-500/40' : 'hover:bg-white/5 border border-transparent'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span className="text-base">{CAT_ICONS[stat.category] || '📁'}</span>
                  <span className="truncate">{stat.category}</span>
                </span>
                <span className="text-xs text-white/40 shrink-0">
                  {stat.code_count > 0 && <span className="text-yellow-300">{stat.code_count}</span>}
                  {stat.code_count > 0 && ' / '}
                  <span>{stat.total}</span>
                </span>
              </button>
            ))}
          </div>

          {/* 右侧: 资源列表 */}
          <div className="bg-[#12121a] rounded-2xl p-4 border border-white/5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-semibold">
                {selectedCategory ? `${CAT_ICONS[selectedCategory] || '📁'} ${selectedCategory}` : '📋 全部资源'}
                <span className="text-sm text-white/40 font-normal ml-2">({displayItems.length} 条)</span>
              </h2>
              {selectedCategory && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-white/40">批量:</span>
                  <select value={batchPayType} onChange={e => setBatchPayType(e.target.value as any)} className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white">
                    <option value="code">付费</option>
                    <option value="free">免费</option>
                  </select>
                  {batchPayType === 'code' && (
                    <input type="number" min="0" max="9999" step="0.5" value={batchPrice}
                      onChange={e => setBatchPrice(parseFloat(e.target.value) || 0)}
                      className="bg-black/40 border border-white/10 rounded px-2 py-1 w-16 text-white" />
                  )}
                  <button
                    onClick={() => handleBatchSet(displayItems.map(i => i.id), batchPayType, batchPayType === 'code' ? batchPrice : 0)}
                    className="px-2 py-1 bg-violet-600 hover:bg-violet-500 rounded text-white text-xs"
                  >
                    全部设为{batchPayType === 'code' ? `¥${batchPrice}` : '免费'}
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-white/40">加载中...</div>
            ) : displayItems.length === 0 ? (
              <div className="text-center py-12 text-white/40 text-sm">
                {selectedCategory ? `${selectedCategory} 暂无符合条件的资源` : '暂无数据'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-2">
                {displayItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 bg-white/5 rounded-lg hover:bg-white/10 group">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2">
                        {item.name}
                        {item.pay_type === 'code' ? (
                          <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs shrink-0 flex items-center gap-1">
                            <Lock className="w-2.5 h-2.5" /> ¥{item.code_price}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs shrink-0 flex items-center gap-1">
                            <Unlock className="w-2.5 h-2.5" /> 免费
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        #{item.id} · {item.source || '?'} · {item.category}
                        {item.tmdb_id && !['NOMATCH', 'GARBLED'].includes(item.tmdb_id) && (
                          <span className="ml-2">TMDB: {item.tmdb_id}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => { setEditing(item); setNewPayType(item.pay_type); setNewPrice(item.code_price); }}
                        className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">
                        <Settings className="w-3 h-3" />
                      </button>
                      {item.pay_type === 'code' && (
                        <button onClick={() => { setGenerating(item); setGenCount(1); setGenPrice(item.code_price); }}
                          className="px-2 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-xs">
                          生成码
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 编辑弹窗 */}
      <AnimatePresence>
        {editing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-white/10" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">配置付费规则</h3>
                <button onClick={() => setEditing(null)} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
              </div>
              <div className="text-sm text-white/60 mb-4 truncate">#{editing.id} · {editing.name}</div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">付费类型</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setNewPayType('free')}
                      className={`p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition ${newPayType === 'free' ? 'bg-emerald-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                      <Unlock className="w-4 h-4" /> 免费
                    </button>
                    <button onClick={() => setNewPayType('code')}
                      className={`p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition ${newPayType === 'code' ? 'bg-yellow-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                      <Lock className="w-4 h-4" /> 付费
                    </button>
                  </div>
                </div>
                {newPayType === 'code' && (
                  <div>
                    <label className="block text-sm text-white/60 mb-2">起步价 (¥)</label>
                    <input type="number" min="0" max="9999" step="0.5" value={newPrice}
                      onChange={e => setNewPrice(parseFloat(e.target.value) || 0)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    <div className="text-xs text-white/40 mt-1">建议: 5-10 (单资源)</div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button onClick={() => setEditing(null)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                <button onClick={handleSave} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">保存</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 生成激活码弹窗 */}
      <AnimatePresence>
        {generating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50" onClick={() => { setGenerating(null); setGenResult(null); }}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl p-6 w-full max-w-2xl border border-white/10" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">生成激活码</h3>
                <button onClick={() => { setGenerating(null); setGenResult(null); }} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
              </div>
              <div className="text-sm text-white/60 mb-4 truncate">资源 #{generating.id}: {generating.name}</div>
              {!genResult ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-white/60 mb-2">生成数量</label>
                      <input type="number" min="1" max="100" value={genCount}
                        onChange={e => setGenCount(parseInt(e.target.value) || 1)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-white/60 mb-2">发行价 (¥)</label>
                      <input type="number" min="0" max="9999" step="0.5" value={genPrice}
                        onChange={e => setGenPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-6 justify-end">
                    <button onClick={() => { setGenerating(null); setGenResult(null); }} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                    <button onClick={handleGenerate} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm">生成</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-sm text-emerald-300">
                    ✅ 成功生成 {genResult.codes.length} 个码 for <strong>{genResult.resource_name}</strong> (¥{genResult.price})
                  </div>
                  <div className="bg-black/40 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-sm">
                    {genResult.codes.map((c, i) => (
                      <div key={i} className="py-0.5 text-yellow-300">{c}</div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-4 justify-end">
                    <button onClick={copyCodes} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm flex items-center gap-1">
                      <Copy className="w-3 h-3" /> 复制全部
                    </button>
                    <button onClick={() => { setGenerating(null); setGenResult(null); }} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">关闭</button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
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