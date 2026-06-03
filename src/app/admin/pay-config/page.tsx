'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

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

const CATEGORIES = ['全部', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影', '连载', '音乐', '体育', '合集'];

export default function PayConfigPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [search, setSearch] = useState('');
  const [payType, setPayType] = useState('');
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [newPayType, setNewPayType] = useState('free');
  const [newPrice, setNewPrice] = useState(0);
  const [generating, setGenerating] = useState<Item | null>(null);
  const [genCount, setGenCount] = useState(1);
  const [genPrice, setGenPrice] = useState(0);
  const [genResult, setGenResult] = useState<{ codes: string[]; resource_name: string; price: number } | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('adminToken') || '';
    setToken(t);
  }, []);

  const load = useCallback(async (p = 1) => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
      });
      if (search) params.set('q', search);
      if (payType) params.set('pay_type', payType);
      const r = await fetch(`/api/admin/pay-config?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      setItems(data.items || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch {}
    setLoading(false);
  }, [token, search, payType, pageSize]);

  useEffect(() => { if (token) load(1); }, [token, payType]);

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
        alert('保存成功');
        setEditing(null);
        load(page);
      } else {
        alert('失败: ' + data.error);
      }
    } catch (e: any) { alert('错误: ' + e.message); }
  };

  const openEdit = (item: Item) => {
    setEditing(item);
    setNewPayType(item.pay_type);
    setNewPrice(item.code_price);
  };

  const openGen = (item: Item) => {
    setGenerating(item);
    setGenCount(1);
    setGenPrice(item.code_price);
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
        setGenResult({
          codes: data.codes,
          resource_name: data.target_resource_name,
          price: data.price_at_issue,
        });
        load(page);
      } else {
        alert('失败: ' + data.error);
      }
    } catch (e: any) { alert('错误: ' + e.message); }
  };

  const copyCodes = () => {
    if (!genResult) return;
    const text = genResult.codes.join('\n');
    navigator.clipboard.writeText(text);
    alert(`已复制 ${genResult.codes.length} 个码到剪贴板`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/admin')} className="p-2 hover:bg-white/10 rounded-lg">←</button>
          <h1 className="text-2xl font-bold">💰 单资源付费配置</h1>
          <a href="/admin/codes" className="ml-auto text-sm text-violet-400 hover:underline">查看激活码 →</a>
        </div>

        {/* 搜索栏 */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load(1)}
            placeholder="按名称搜索资源..."
            className="flex-1 min-w-[200px] bg-white/5 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40"
          />
          <select value={payType} onChange={e => { setPayType(e.target.value); setPage(1); }}
            className="bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white">
            <option value="" style={{ color: '#1a1a2e' }}>全部付费类型</option>
            <option value="free" style={{ color: '#1a1a2e' }}>免费</option>
            <option value="code" style={{ color: '#1a1a2e' }}>激活码</option>
          </select>
          <button onClick={() => load(1)} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">搜索</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div className="text-center py-12 text-white/40">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-12 text-white/40">暂无数据</div>
        ) : (
          <div className="space-y-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl hover:bg-white/10">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate flex items-center gap-2">
                    {item.name}
                    {item.pay_type === 'code' && (
                      <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs shrink-0">¥{item.code_price}</span>
                    )}
                    {item.pay_type === 'free' && (
                      <span className="px-2 py-0.5 bg-green-500/20 text-green-300 rounded text-xs shrink-0">免费</span>
                    )}
                  </div>
                  <div className="text-xs text-white/40 mt-1">
                    {item.category} · {item.source} · #{item.id}
                    {item.tmdb_id && !['NOMATCH', 'GARBLED'].includes(item.tmdb_id) && (
                      <span className="ml-2">TMDB: {item.tmdb_id}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => openEdit(item)} className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs">配置</button>
                  {item.pay_type === 'code' && (
                    <button onClick={() => openGen(item)} className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-xs">生成激活码</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 分页 */}
        {total > pageSize && (
          <div className="flex justify-center gap-2 mt-4">
            <button onClick={() => load(page - 1)} disabled={page <= 1} className="px-3 py-1 bg-white/10 rounded text-sm disabled:opacity-30">上一页</button>
            <span className="px-3 py-1 text-sm text-white/60">{page} / {Math.ceil(total / pageSize)}</span>
            <button onClick={() => load(page + 1)} disabled={page >= Math.ceil(total / pageSize)} className="px-3 py-1 bg-white/10 rounded text-sm disabled:opacity-30">下一页</button>
          </div>
        )}

        {/* 编辑弹窗 */}
        {editing && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-[#12121a] rounded-2xl p-6 w-full max-w-md border border-white/10">
              <h3 className="text-lg font-semibold mb-4">配置付费规则</h3>
              <div className="text-sm text-white/60 mb-4 truncate">{editing.name}</div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-white/60 mb-2">付费类型</label>
                  <select value={newPayType} onChange={e => setNewPayType(e.target.value)}
                    className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white">
                    <option value="free" style={{ color: '#1a1a2e' }}>免费（所有人可看）</option>
                    <option value="code" style={{ color: '#1a1a2e' }}>激活码（额外付费）</option>
                  </select>
                </div>
                {newPayType === 'code' && (
                  <div>
                    <label className="block text-sm text-white/60 mb-2">起步价 (¥)</label>
                    <input type="number" min="0" max="9999" step="0.01" value={newPrice}
                      onChange={e => setNewPrice(parseFloat(e.target.value) || 0)}
                      className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white" />
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button onClick={() => setEditing(null)} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                <button onClick={handleSave} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">保存</button>
              </div>
            </div>
          </div>
        )}

        {/* 生成激活码弹窗 */}
        {generating && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50">
            <div className="bg-[#12121a] rounded-2xl p-6 w-full max-w-2xl border border-white/10">
              <h3 className="text-lg font-semibold mb-2">生成激活码</h3>
              <div className="text-sm text-white/60 mb-4 truncate">资源: {generating.name}</div>
              {!genResult ? (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-white/60 mb-2">生成数量</label>
                      <input type="number" min="1" max="100" value={genCount}
                        onChange={e => setGenCount(parseInt(e.target.value) || 1)}
                        className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-white/60 mb-2">发行价 (¥)</label>
                      <input type="number" min="0" max="9999" step="0.01" value={genPrice}
                        onChange={e => setGenPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-white" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-6 justify-end">
                    <button onClick={() => { setGenerating(null); setGenResult(null); }} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">取消</button>
                    <button onClick={handleGenerate} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded-lg text-sm">生成</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-sm">
                    ✅ 成功生成 {genResult.codes.length} 个码 for <strong>{genResult.resource_name}</strong> (¥{genResult.price})
                  </div>
                  <div className="bg-black/40 rounded-lg p-3 max-h-64 overflow-y-auto font-mono text-sm">
                    {genResult.codes.map((c, i) => (
                      <div key={i} className="py-0.5 text-yellow-300">{c}</div>
                    ))}
                  </div>
                  <div className="flex gap-2 mt-4 justify-end">
                    <button onClick={copyCodes} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm">复制全部</button>
                    <button onClick={() => { setGenerating(null); setGenResult(null); }} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">关闭</button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
