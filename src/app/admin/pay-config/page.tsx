'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Search, Settings, Lock, Unlock, Copy, X, Sparkles, Coins, FileText, Plus, Upload, Download, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

interface Item {
  id: number;
  name: string;
  category: string;
  doc_sheet: string | null;
  pay_type: string;
  code_price: number;
  lumen_cost: number;
  access_level: string;
  import_channel: string;
  source: string;
  tmdb_id: string;
  size: string;
  sub_type: string;
  created_at: string;
  poster_path: string;
}

interface SheetStat {
  name: string;
  key: string;
  total: number;
  codeCount: number;
}

export default function PayConfigPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [sheets, setSheets] = useState<SheetStat[]>([]);
  const [unclassified, setUnclassified] = useState<{ total: number; codeCount: number }>({ total: 0, codeCount: 0 });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [payType, setPayType] = useState('');  // '' = 全部, 'free', 'code'
  const [selectedSheet, setSelectedSheet] = useState<string>('');  // '' = 全部, '__unclassified__' = 未分类
  const [editing, setEditing] = useState<Item | null>(null);
  const [newPayType, setNewPayType] = useState('free');
  const [newPrice, setNewPrice] = useState(0);
  const [newLumen, setNewLumen] = useState(1);
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

  // 加载 sheet 列表
  const loadSheets = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch('/api/admin/pay-config/sheets', { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (!d.error) {
        setSheets(d.sheets || []);
        setUnclassified(d.unclassified || { total: 0, codeCount: 0 });
      }
    } catch {}
  }, [token]);

  // 加载资源列表
  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '200' });
      if (search.trim()) params.set('q', search.trim());
      if (payType) params.set('pay_type', payType);
      if (selectedSheet === '__unclassified__') params.set('doc_sheet', '__null__');
      else if (selectedSheet) params.set('doc_sheet', selectedSheet);
      const r = await fetch(`/api/admin/pay-config?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await r.json();
      if (data.error) showToast('error', data.error);
      else setItems(data.items || []);
    } catch (e: any) { showToast('error', e.message); }
    finally { setLoading(false); }
  }, [token, search, payType, selectedSheet]);

  useEffect(() => {
    if (token) loadSheets();
  }, [token, loadSheets]);

  useEffect(() => {
    if (token) load();
  }, [token, load]);

  // 当前选 sheet 的统计
  const currentSheetStat = useMemo(() => {
    if (!selectedSheet) return { total: items.length, codeCount: items.filter(i => i.pay_type === 'code').length };
    if (selectedSheet === '__unclassified__') return unclassified;
    return sheets.find(s => s.key === selectedSheet) || { total: 0, codeCount: 0 };
  }, [selectedSheet, items, sheets, unclassified]);

  // 当前显示
  const displayItems = useMemo(() => {
    if (!selectedSheet) return items.slice(0, 100);
    return items;
  }, [items, selectedSheet]);

  const handleSave = async () => {
    if (!editing || !token) return;
    try {
      const r = await fetch('/api/admin/pay-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          id: editing.id,
          pay_type: newPayType,
          code_price: newPrice,
          lumen_cost: newLumen,
        }),
      });
      const data = await r.json();
      if (data.success) {
        showToast('success', '✅ 已保存');
        setEditing(null);
        load();
        loadSheets();
      } else {
        showToast('error', data.error || '失败');
      }
    } catch (e: any) { showToast('error', e.message); }
  };

  const handleBatchSet = async (ids: number[], pay_type: string, price: number, lumen: number) => {
    if (!ids.length || !token) return;
    if (!confirm(`确认将 ${ids.length} 个资源设置为 ${pay_type === 'code' ? `付费 ¥${price} (${lumen} 流明)` : '免费'}？`)) return;
    try {
      const promises = ids.map(id =>
        fetch('/api/admin/pay-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, pay_type, code_price: price, lumen_cost: lumen }),
        }).then(r => r.json())
      );
      const results = await Promise.all(promises);
      const okCount = results.filter(r => r.success).length;
      showToast('success', `✅ 批量设置 ${okCount}/${ids.length} 个`);
      load();
      loadSheets();
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

  // 批量操作 state
  const [batchPrice, setBatchPrice] = useState(5);
  const [batchLumen, setBatchLumen] = useState(1);
  const [batchPayType, setBatchPayType] = useState<'code' | 'free'>('code');

  // 2026-08-16: 新增资源弹窗 state
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] = useState('其他');
  const [newSubType, setNewSubType] = useState('独立');
  const [newSize, setNewSize] = useState('');
  const [newLink, setNewLink] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCreatePayType, setNewCreatePayType] = useState<'lumen' | 'free' | 'code'>('lumen');
  const [newCreateLumen, setNewCreateLumen] = useState(10);
  const [newCreatePrice, setNewCreatePrice] = useState(5);
  const [creatingSaving, setCreatingSaving] = useState(false);

  const CATEGORIES = ['电影', '剧集', '动漫', '纪录片', '综艺', '演唱会', '连载', '原盘', 'REMUX', '系列电影', '合集', '音乐', '体育', '电子书', '其他'];
  const SUB_TYPES = ['独立', '合集', '原盘', 'REMUX', '系列'];

  const handleCreate = async () => {
    if (!token) return;
    if (!newName.trim() || !newLink.trim()) {
      showToast('error', '名称和链接必填');
      return;
    }
    setCreatingSaving(true);
    try {
      const r = await fetch('/api/admin/pay-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          mode: 'create',
          name: newName.trim(),
          category: newCategory,
          sub_type: newSubType,
          size: newSize.trim(),
          link: newLink.trim(),
          description: newDescription.trim(),
          pay_type: newCreatePayType,
          lumen_cost: newCreatePayType === 'lumen' ? newCreateLumen : (newCreatePayType === 'code' ? newCreateLumen : 0),
          code_price: newCreatePayType === 'code' ? newCreatePrice : 0,
        }),
      });
      const data = await r.json();
      if (data.success) {
        showToast('success', data.message || '✅ 已发布');
        setCreating(false);
        // reset form
        setNewName(''); setNewSize(''); setNewLink(''); setNewDescription('');
        load();
        loadSheets();
      } else {
        showToast('error', data.error || '失败');
      }
    } catch (e: any) { showToast('error', e.message); }
    finally { setCreatingSaving(false); }
  };

  // 2026-08-17: 批量导入 state
  const [batchImporting, setBatchImporting] = useState(false);
  const [batchTab, setBatchTab] = useState<'excel' | 'txt'>('excel');
  const [batchItems, setBatchItems] = useState<any[]>([]);
  const [batchErrors, setBatchErrors] = useState<Array<string | { index: number; name?: string; error: string }>>([]);
  const [batchImporting2, setBatchImporting2] = useState(false);
  const [batchResult, setBatchResult] = useState<{ inserted: number; skipped: number; skipped_details: any[]; items: any[] } | null>(null);
  const [batchTxtContent, setBatchTxtContent] = useState('');

  // Excel 解析: 转成 items
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBatchErrors([]);
    setBatchItems([]);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws, { defval: '' });
      if (rows.length === 0) {
        setBatchErrors(['Excel 是空的']);
        return;
      }
      // 列名映射 (兼容大小写/空格)
      const normalize = (s: any) => String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
      const mapped: any[] = rows.map((r, i) => {
        const o: any = {};
        for (const k in r) {
          o[normalize(k)] = r[k];
        }
        return {
          name: o.name || o.名称 || o.标题,
          category: o.category || o.类别,
          sub_type: o.sub_type || o.子类型 || o.资源类型 || '独立',
          link: o.link || o.链接,
          pay_type: (o.pay_type || o.付费类型 || 'lumen').toLowerCase(),
          lumen_cost: o.lumen_cost || o.流明定价 || 10,
          size: o.size || o.大小 || '',
          description: o.description || o.备注 || o.详情 || '',
        };
      });
      setBatchItems(mapped);
      showToast('success', `✅ 解析 ${mapped.length} 条 (预览前 10 条)`);
    } catch (e: any) {
      setBatchErrors(['Excel 解析失败: ' + e.message]);
    }
  };

  // TXT 解析: tab 或 | 分隔, 顺序 = name \t category \t sub_type \t link \t pay_type \t lumen_cost \t size
  const handleTxtParse = () => {
    setBatchErrors([]);
    setBatchItems([]);
    const lines = batchTxtContent.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (lines.length === 0) {
      setBatchErrors(['内容为空']);
      return;
    }
    const sep = lines[0].includes('\t') ? '\t' : (lines[0].includes('|') ? '|' : null);
    if (!sep) {
      setBatchErrors(['格式错误: 每行用 \\t 或 | 分隔, 列顺序: name\\tcategory\\tsub_type\\tlink\\tpay_type\\tlumen_cost\\tsize']);
      return;
    }
    const parsed: any[] = lines.map((line, i) => {
      const cols = line.split(sep).map(c => c.trim());
      return {
        name: cols[0] || '',
        category: cols[1] || '',
        sub_type: cols[2] || '独立',
        link: cols[3] || '',
        pay_type: (cols[4] || 'lumen').toLowerCase(),
        lumen_cost: Number(cols[5]) || 10,
        size: cols[6] || '',
        description: cols[7] || '',
      };
    });
    setBatchItems(parsed);
    showToast('success', `✅ 解析 ${parsed.length} 条 (预览前 10 条)`);
  };

  // 批量提交: 流式分批 500/批
  const handleBatchSubmit = async () => {
    if (!token || batchItems.length === 0) return;
    setBatchImporting2(true);
    setBatchResult(null);
    try {
      const BATCH = 500;
      let totalInserted = 0;
      let totalSkipped = 0;
      const allSkipped: any[] = [];
      const allInserted: any[] = [];
      for (let i = 0; i < batchItems.length; i += BATCH) {
        const batch = batchItems.slice(i, i + BATCH);
        const r = await fetch('/api/admin/pay-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ mode: 'batch_create', items: batch }),
        });
        const d = await r.json();
        if (!d.success) {
          // 整批没过
          setBatchErrors(d.errors || [d.error || '批量失败']);
          showToast('error', d.error || '整批未通过');
          return;
        }
        totalInserted += d.inserted;
        totalSkipped += d.skipped;
        allSkipped.push(...(d.skipped_details || []));
        allInserted.push(...(d.items || []));
      }
      setBatchResult({ inserted: totalInserted, skipped: totalSkipped, skipped_details: allSkipped, items: allInserted });
      showToast('success', `✅ 批量完成: 插入 ${totalInserted} 条, 跳过 ${totalSkipped} 条`);
      load();
      loadSheets();
    } catch (e: any) {
      showToast('error', e.message);
    } finally { setBatchImporting2(false); }
  };

  // 模板下载
  const downloadTemplate = (type: 'xlsx' | 'txt') => {
    const headers = ['name', 'category', 'sub_type', 'link', 'pay_type', 'lumen_cost', 'size', 'description'];
    const sampleRow = ['《示例资源》4K HDR 中字', '电影', '独立', 'https://pan.baidu.com/s/xxx#pwd=abc', 'lumen', 10, '15 GB / 4K HDR', '示例备注'];
    if (type === 'xlsx') {
      const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '付费资源');
      XLSX.writeFile(wb, 'pay-config-template.xlsx');
    } else {
      const txt = '# name\\tcategory\\tsub_type\\tlink\\tpay_type\\tlumen_cost\\tsize\\tdescription\n' + sampleRow.join('\t') + '\n';
      const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'pay-config-template.txt';
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.push('/admin')} className="p-2 hover:bg-white/10 rounded-lg">←</button>
          <h1 className="text-2xl font-bold">💎 单资源付费配置</h1>
          <button onClick={() => setBatchImporting(true)}
            className="ml-auto px-3 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Upload className="w-4 h-4" /> 批量导入
          </button>
          <button onClick={() => setCreating(true)}
            className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> 新增资源
          </button>
          <a href="/admin/codes" className="text-sm text-violet-400 hover:underline">查看激活码 →</a>
        </div>

        {/* 搜索栏 */}
        <div className="flex gap-2 mb-4 flex-wrap bg-[#12121a] rounded-2xl p-3 border border-white/5">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="按名称/ID 搜索资源（输入后回车）..."
              className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-white placeholder-white/40 focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <select value={payType} onChange={e => { setPayType(e.target.value); }}
            className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm" style={{ colorScheme: 'dark' }}>
            <option value="" className="bg-[#0a0a0f] text-white">全部付费类型</option>
            <option value="free" className="bg-[#0a0a0f] text-white">免费</option>
            <option value="paid" className="bg-[#0a0a0f] text-white">付费 (code/lumen)</option>
            <option value="code" className="bg-[#0a0a0f] text-white">仅激活码 (code)</option>
            <option value="lumen" className="bg-[#0a0a0f] text-white">仅流明 (lumen)</option>
          </select>
          <button onClick={load} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm flex items-center gap-1">
            <Search className="w-3 h-3" /> 搜索
          </button>
          <button onClick={() => { setSearch(''); setPayType(''); setSelectedSheet(''); }} className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm">
            <X className="w-3 h-3" /> 清空
          </button>
        </div>

        {/* 总览统计 */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="bg-[#12121a] rounded-xl p-3 border border-white/5">
            <div className="text-xs text-white/40">当前 sheet 总数</div>
            <div className="text-xl font-bold mt-0.5">{currentSheetStat.total.toLocaleString()}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-3 border border-yellow-500/20">
            <div className="text-xs text-yellow-300/80">已设置付费</div>
            <div className="text-xl font-bold mt-0.5 text-yellow-300">{currentSheetStat.codeCount}</div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-3 border border-fuchsia-500/20">
            <div className="text-xs text-fuchsia-300/80">总消耗流明</div>
            <div className="text-xl font-bold mt-0.5 text-fuchsia-300">
              💎 {displayItems.filter(i => i.pay_type === 'code').reduce((s, i) => s + (i.lumen_cost || 1), 0)}
            </div>
          </div>
          <div className="bg-[#12121a] rounded-xl p-3 border border-emerald-500/20">
            <div className="text-xs text-emerald-300/80">免费资源</div>
            <div className="text-xl font-bold mt-0.5 text-emerald-300">
              {currentSheetStat.total - currentSheetStat.codeCount}
            </div>
          </div>
        </div>

        {/* 主体: 左 sheet 列表 + 右资源列表 */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* 左侧: sheet 列表 */}
          <div className="bg-[#12121a] rounded-2xl p-3 border border-white/5 max-h-[70vh] overflow-y-auto">
            <div className="text-xs text-white/40 mb-2 px-2 sticky top-0 bg-[#12121a] py-2">
              📑 文档 sheet ({sheets.length})
            </div>
            <button
              onClick={() => setSelectedSheet('')}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between mb-1 ${!selectedSheet ? 'bg-violet-600/30 border border-violet-500/40' : 'hover:bg-white/5 border border-transparent'}`}
            >
              <span className="flex items-center gap-2 min-w-0">
                <Sparkles className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                <span className="font-medium">全部</span>
              </span>
              <span className="text-xs text-white/40 shrink-0">
                {sheets.reduce((s, sh) => s + sh.total, 0) + unclassified.total}
              </span>
            </button>
            {sheets.map(sh => (
              <button
                key={sh.key}
                onClick={() => setSelectedSheet(sh.key)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between mb-1 ${selectedSheet === sh.key ? 'bg-violet-600/30 border border-violet-500/40' : 'hover:bg-white/5 border border-transparent'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{sh.name}</span>
                </span>
                <span className="text-xs text-white/40 shrink-0">
                  {sh.codeCount > 0 && <span className="text-yellow-300">{sh.codeCount}</span>}
                  {sh.codeCount > 0 && ' / '}
                  <span>{sh.total}</span>
                </span>
              </button>
            ))}
            {unclassified.total > 0 && (
              <button
                onClick={() => setSelectedSheet('__unclassified__')}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between mb-1 mt-2 border-t border-white/5 pt-2 ${selectedSheet === '__unclassified__' ? 'bg-violet-600/30 border border-violet-500/40' : 'hover:bg-white/5 border border-transparent'}`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  <span>📦</span>
                  <span className="truncate">未分类 (原盘等)</span>
                </span>
                <span className="text-xs text-white/40 shrink-0">
                  {unclassified.codeCount > 0 && <span className="text-yellow-300">{unclassified.codeCount}</span>}
                  {unclassified.codeCount > 0 && ' / '}
                  <span>{unclassified.total}</span>
                </span>
              </button>
            )}
          </div>

          {/* 右侧: 资源列表 */}
          <div className="bg-[#12121a] rounded-2xl p-4 border border-white/5">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <h2 className="text-lg font-semibold">
                {selectedSheet === '__unclassified__' ? '📦 未分类' :
                 selectedSheet ? `📑 ${selectedSheet}` : '📋 全部资源'}
                <span className="text-sm text-white/40 font-normal ml-2">({displayItems.length} 条{!selectedSheet && displayItems.length >= 100 ? '+' : ''})</span>
              </h2>
              {selectedSheet && displayItems.length > 0 && (
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="text-white/40">批量:</span>
                  <select value={batchPayType} onChange={e => setBatchPayType(e.target.value as any)} className="bg-black/40 border border-white/10 rounded px-2 py-1 text-white">
                    <option value="code">付费</option>
                    <option value="free">免费</option>
                  </select>
                  {batchPayType === 'code' && (
                    <>
                      <input type="number" min="0" max="9999" step="0.5" value={batchPrice}
                        onChange={e => setBatchPrice(parseFloat(e.target.value) || 0)}
                        className="bg-black/40 border border-white/10 rounded px-2 py-1 w-16 text-white"
                        title="起步价" />
                      <span className="text-white/40">¥</span>
                      <input type="number" min="1" max="999" value={batchLumen}
                        onChange={e => setBatchLumen(parseInt(e.target.value) || 1)}
                        className="bg-black/40 border border-white/10 rounded px-2 py-1 w-14 text-white"
                        title="消耗流明" />
                      <span className="text-white/40">流明</span>
                    </>
                  )}
                  <button
                    onClick={() => handleBatchSet(displayItems.map(i => i.id), batchPayType, batchPayType === 'code' ? batchPrice : 0, batchPayType === 'code' ? batchLumen : 0)}
                    className="px-2 py-1 bg-violet-600 hover:bg-violet-500 rounded text-white text-xs"
                  >
                    全部设为{batchPayType === 'code' ? `¥${batchPrice} / ${batchLumen}💎` : '免费'}
                  </button>
                </div>
              )}
            </div>

            {loading ? (
              <div className="text-center py-12 text-white/40">加载中...</div>
            ) : displayItems.length === 0 ? (
              <div className="text-center py-12 text-white/40 text-sm">
                {selectedSheet ? `${selectedSheet === '__unclassified__' ? '未分类' : selectedSheet} 暂无符合条件的资源` : '暂无数据'}
              </div>
            ) : (
              <div className="space-y-2 max-h-[65vh] overflow-y-auto pr-2">
                {displayItems.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-2.5 bg-white/5 rounded-lg hover:bg-white/10 group">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate flex items-center gap-2 flex-wrap">
                        <span className="truncate max-w-[40ch]">{item.name}</span>
                        {item.pay_type === 'code' ? (
                          <>
                            <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-300 rounded text-xs shrink-0 flex items-center gap-1">
                              <Lock className="w-2.5 h-2.5" /> ¥{item.code_price}
                            </span>
                            <span className="px-1.5 py-0.5 bg-fuchsia-500/20 text-fuchsia-300 rounded text-xs shrink-0 flex items-center gap-1">
                              <Coins className="w-2.5 h-2.5" /> {item.lumen_cost} 流明
                            </span>
                          </>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs shrink-0 flex items-center gap-1">
                            <Unlock className="w-2.5 h-2.5" /> 免费
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">
                        #{item.id} · {item.source || '?'} · {item.doc_sheet || item.category || '?'}
                        {item.tmdb_id && !['NOMATCH', 'GARBLED'].includes(item.tmdb_id) && (
                          <span className="ml-2">TMDB: {item.tmdb_id}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => {
                        setEditing(item);
                        setNewPayType(item.pay_type);
                        setNewPrice(item.code_price);
                        setNewLumen(item.lumen_cost || 1);
                      }}
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
              {editing.doc_sheet && (
                <div className="text-xs text-cyan-300 mb-3 flex items-center gap-1">
                  <FileText className="w-3 h-3" /> 所属 sheet: <b>{editing.doc_sheet}</b>
                </div>
              )}
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
                  <>
                    <div>
                      <label className="block text-sm text-white/60 mb-2">起步价 (¥)</label>
                      <input type="number" min="0" max="9999" step="0.5" value={newPrice}
                        onChange={e => setNewPrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                      <div className="text-xs text-white/40 mt-1">建议: 5-10 (单资源起步价)</div>
                    </div>
                    <div>
                      <label className="block text-sm text-white/60 mb-2 flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-fuchsia-400" /> 所需流明 (1-999)
                      </label>
                      <input type="number" min="1" max="999" value={newLumen}
                        onChange={e => setNewLumen(parseInt(e.target.value) || 1)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                      <div className="text-xs text-white/40 mt-1">用户解锁时消耗的流明数 (流明通过兑换码充值)</div>
                    </div>
                  </>
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

      {/* 2026-08-16: 新增资源弹窗 */}
      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => !creatingSaving && setCreating(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl p-6 w-full max-w-2xl border border-violet-500/30 my-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2"><Plus className="w-5 h-5 text-violet-400" /> 新增单资源付费</h3>
                <button onClick={() => setCreating(false)} className="p-1 hover:bg-white/10 rounded"><X className="w-4 h-4" /></button>
              </div>
              <div className="text-xs text-white/40 mb-4">填写后用户即可在 catalog 看到此资源（链接默认隐藏，付费/流明解锁后可见）</div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">标题 *</label>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="如：阿凡达：水之道 4K HDR"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm text-white/60 mb-1.5">类别 (21 类) *</label>
                    <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                      style={{ colorScheme: 'dark' }}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white">
                      {CATEGORIES.map(c => <option key={c} value={c} className="bg-[#0a0a0f] text-white">{c}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-white/60 mb-1.5">资源类型 *</label>
                    <select value={newSubType} onChange={e => setNewSubType(e.target.value)}
                      style={{ colorScheme: 'dark' }}
                      className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white">
                      {SUB_TYPES.map(s => <option key={s} value={s} className="bg-[#0a0a0f] text-white">{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">链接 *</label>
                  <input value={newLink} onChange={e => setNewLink(e.target.value)}
                    placeholder="如：https://pan.baidu.com/s/xxx 或 magnet:?xt=urn:btih:xxx"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 font-mono text-xs" />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">大小 (可选)</label>
                  <input value={newSize} onChange={e => setNewSize(e.target.value)}
                    placeholder="如：12.5 GB / 1080P / 4K HDR"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30" />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">详情 / 备注 (可选)</label>
                  <textarea value={newDescription} onChange={e => setNewDescription(e.target.value)}
                    rows={3}
                    placeholder="如：含中字、含特效字幕、4K 原盘转 REMUX..."
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 resize-none" />
                </div>
                <div>
                  <label className="block text-sm text-white/60 mb-1.5">付费方式 *</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button onClick={() => setNewCreatePayType('lumen')}
                      className={`p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition ${newCreatePayType === 'lumen' ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                      <Coins className="w-4 h-4" /> 流明 (推荐)
                    </button>
                    <button onClick={() => setNewCreatePayType('code')}
                      className={`p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition ${newCreatePayType === 'code' ? 'bg-yellow-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                      <Lock className="w-4 h-4" /> 激活码
                    </button>
                    <button onClick={() => setNewCreatePayType('free')}
                      className={`p-3 rounded-lg text-sm flex items-center justify-center gap-2 transition ${newCreatePayType === 'free' ? 'bg-emerald-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
                      <Unlock className="w-4 h-4" /> 免费
                    </button>
                  </div>
                </div>
                {newCreatePayType === 'lumen' && (
                  <div>
                    <label className="block text-sm text-white/60 mb-1.5 flex items-center gap-1">
                      <Coins className="w-3.5 h-3.5 text-violet-400" /> 流明定价 (1-100) *
                    </label>
                    <input type="number" min="1" max="100" value={newCreateLumen}
                      onChange={e => setNewCreateLumen(parseInt(e.target.value) || 1)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    <div className="text-xs text-white/40 mt-1">用户用流明兑换解锁，建议 5-30 流明</div>
                  </div>
                )}
                {newCreatePayType === 'code' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-white/60 mb-1.5">起步价 (¥)</label>
                      <input type="number" min="0" max="9999" step="0.5" value={newCreatePrice}
                        onChange={e => setNewCreatePrice(parseFloat(e.target.value) || 0)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    </div>
                    <div>
                      <label className="block text-sm text-white/60 mb-1.5 flex items-center gap-1">
                        <Coins className="w-3.5 h-3.5 text-fuchsia-400" /> 流明 (1-100)
                      </label>
                      <input type="number" min="1" max="100" value={newCreateLumen}
                        onChange={e => setNewCreateLumen(parseInt(e.target.value) || 1)}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white" />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-6 justify-end">
                <button onClick={() => setCreating(false)} disabled={creatingSaving} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm disabled:opacity-50">取消</button>
                <button onClick={handleCreate} disabled={creatingSaving} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                  {creatingSaving ? '发布中...' : '🚀 发布资源'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 2026-08-17: 批量导入弹窗 (Excel + TXT) */}
      <AnimatePresence>
        {batchImporting && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50 overflow-y-auto" onClick={() => !batchImporting2 && setBatchImporting(false)}>
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              className="bg-[#12121a] rounded-2xl p-6 w-full max-w-4xl border border-cyan-500/30 my-8" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2"><Upload className="w-5 h-5 text-cyan-400" /> 批量导入付费资源</h3>
                <button onClick={() => setBatchImporting(false)} disabled={batchImporting2} className="p-1 hover:bg-white/10 rounded disabled:opacity-50"><X className="w-4 h-4" /></button>
              </div>

              {/* 标签页 */}
              <div className="flex items-center gap-2 mb-4 border-b border-white/10">
                <button onClick={() => setBatchTab('excel')}
                  className={`px-4 py-2 text-sm flex items-center gap-1.5 border-b-2 ${batchTab === 'excel' ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-white/60 hover:text-white'}`}>
                  <FileSpreadsheet className="w-4 h-4" /> Excel (.xlsx)
                </button>
                <button onClick={() => setBatchTab('txt')}
                  className={`px-4 py-2 text-sm flex items-center gap-1.5 border-b-2 ${batchTab === 'txt' ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-white/60 hover:text-white'}`}>
                  <FileText className="w-4 h-4" /> TXT/CSV 粘贴
                </button>
                <div className="ml-auto flex items-center gap-2 text-xs">
                  <button onClick={() => downloadTemplate('xlsx')} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white flex items-center gap-1">
                    <Download className="w-3 h-3" /> Excel 模板
                  </button>
                  <button onClick={() => downloadTemplate('txt')} className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded text-white/60 hover:text-white flex items-center gap-1">
                    <Download className="w-3 h-3" /> TXT 模板
                  </button>
                </div>
              </div>

              {/* 列说明 */}
              <div className="mb-3 p-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg text-xs text-white/70">
                <div className="font-medium text-cyan-300 mb-1">📋 列说明 (8 列, 用 \\t 或 | 分隔):</div>
                <div>必填: <code className="text-cyan-300">name / category / sub_type / link / pay_type / lumen_cost</code></div>
                <div>可选: <code className="text-white/60">size / description</code></div>
                <div>值: <code className="text-cyan-300">category</code> ∈ 电影/剧集/动漫/纪录片/综艺/演唱会/连载/原盘/REMUX/系列电影/合集/音乐/体育/电子书/其他 | <code className="text-cyan-300">sub_type</code> ∈ 独立/合集/原盘/REMUX/系列 | <code className="text-cyan-300">pay_type</code> ∈ free/lumen/code | <code className="text-cyan-300">lumen_cost</code> 1-100</div>
                <div className="text-amber-300 mt-1">⚠️ 整批校验: 任一行字段不合法, 整批拒绝不入库 (拍板 3) · 重复 link 跳过 (拍板 4) · 上限不限流式分批 500/批 (拍板 5)</div>
              </div>

              {batchTab === 'excel' ? (
                <div className="mb-3">
                  <label className="block text-sm text-white/60 mb-1.5">选择 Excel 文件 (.xlsx)</label>
                  <input type="file" accept=".xlsx,.xls" onChange={handleExcelUpload}
                    className="block w-full text-sm text-white/80 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-cyan-600 file:text-white hover:file:bg-cyan-500" />
                </div>
              ) : (
                <div className="mb-3">
                  <label className="block text-sm text-white/60 mb-1.5">粘贴内容 (每行一资源, \\t 或 | 分隔)</label>
                  <textarea value={batchTxtContent} onChange={e => setBatchTxtContent(e.target.value)}
                    rows={8}
                    placeholder="《阿凡达：水之道》4K HDR&#9;电影&#9;独立&#9;https://pan.baidu.com/s/xxx#pwd=abc&#9;lumen&#9;10&#9;15 GB&#9;含中字"
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 font-mono text-xs resize-y" />
                  <button onClick={handleTxtParse} className="mt-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 rounded text-xs">
                    🔍 解析
                  </button>
                </div>
              )}

              {/* 错误提示 */}
              {batchErrors.length > 0 && (
                <div className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-xs">
                  <div className="font-medium text-red-300 mb-1">❌ 错误 ({batchErrors.length})</div>
                  <div className="space-y-0.5 text-red-200/80 max-h-32 overflow-y-auto">
                    {batchErrors.slice(0, 10).map((e, i) => <div key={i}>• {typeof e === 'string' ? e : `${e.name || ('行 ' + e.index)}: ${e.error}`}</div>)}
                    {batchErrors.length > 10 && <div>... 还有 {batchErrors.length - 10} 条</div>}
                  </div>
                </div>
              )}

              {/* 预览表 */}
              {batchItems.length > 0 && (
                <div className="mb-3">
                  <div className="text-xs text-white/60 mb-1">📊 预览前 {Math.min(10, batchItems.length)} 条 (共 {batchItems.length} 条):</div>
                  <div className="bg-black/30 rounded-lg p-2 max-h-48 overflow-y-auto text-xs">
                    <div className="grid grid-cols-[1fr_60px_60px_120px_60px_50px] gap-2 text-white/40 mb-1 px-1">
                      <div>name</div><div>category</div><div>sub_type</div><div>link (前 20)</div><div>pay_type</div><div>lumen</div>
                    </div>
                    {batchItems.slice(0, 10).map((it, i) => (
                      <div key={i} className="grid grid-cols-[1fr_60px_60px_120px_60px_50px] gap-2 py-0.5 border-t border-white/5 px-1">
                        <div className="truncate text-white/90">{it.name}</div>
                        <div className="text-white/70">{it.category}</div>
                        <div className="text-white/70">{it.sub_type}</div>
                        <div className="text-white/50 truncate font-mono text-[10px]">{String(it.link || '').slice(0, 20)}</div>
                        <div className={it.pay_type === 'lumen' ? 'text-violet-300' : it.pay_type === 'code' ? 'text-yellow-300' : 'text-emerald-300'}>{it.pay_type}</div>
                        <div className="text-violet-300">{it.lumen_cost}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 结果 */}
              {batchResult && (
                <div className="mb-3 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm">
                  <div className="font-medium text-emerald-300">✅ 批量完成</div>
                  <div className="text-xs text-emerald-200/80 mt-1">插入 {batchResult.inserted} 条, 跳过 {batchResult.skipped} 条 (重复 link)</div>
                  {batchResult.skipped > 0 && (
                    <details className="mt-1">
                      <summary className="text-xs text-white/60 cursor-pointer">查看跳过明细 ({batchResult.skipped})</summary>
                      <div className="text-xs text-white/60 mt-1 max-h-32 overflow-y-auto">
                        {batchResult.skipped_details.slice(0, 20).map((s, i) => <div key={i}>• #{s.index + 1} {s.name}: {s.reason}</div>)}
                      </div>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={() => { setBatchImporting(false); setBatchItems([]); setBatchResult(null); setBatchErrors([]); setBatchTxtContent(''); }} disabled={batchImporting2} className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm disabled:opacity-50">
                  {batchResult ? '关闭' : '取消'}
                </button>
                {!batchResult && (
                  <button onClick={handleBatchSubmit} disabled={batchImporting2 || batchItems.length === 0}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 rounded-lg text-sm font-medium flex items-center gap-1 disabled:opacity-50">
                    {batchImporting2 ? '导入中...' : `🚀 批量导入 ${batchItems.length} 条`}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
