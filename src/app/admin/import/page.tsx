'use client';

import { useState, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import * as XLSX from 'xlsx';

interface ImportResult {
  batch: number;
  imported: number;
  failed: number;
  total: number;
}

type ImportMode = 'zzmm' | 'standard' | 'doc';
const MODES: { key: ImportMode; label: string; icon: string; desc: string }[] = [
  { key: 'zzmm', label: '泽泽妈妈', icon: '🏠', desc: '多 sheet Excel，自动识别分类（21个sheet对应21个分类）' },
  { key: 'standard', label: '标准 Excel', icon: '📊', desc: '固定表头：名称/链接/提取码/大小/分类' },
  { key: 'doc', label: '线上文档', icon: '🔗', desc: '飞书文档 URL，自动解析数据' },
];

// 泽泽妈妈 sheet → category 映射
// 导航首页 = 跳过，4K原盘+原盘资源 = 合并为原盘
const ZZMM_SHEET_MAP: Record<string, string | null> = {
  '导航首页': null, // 跳过，非资源分类
  '电影': '电影', '外语电影': '电影', '华语电影': '电影', '动画电影': '电影',
  '国产剧': '剧集', '欧美剧': '剧集', '韩日剧': '剧集', '港台剧': '剧集',
  '动漫': '动漫',
  '纪录片': '纪录片',
  '综艺': '综艺',
  '演唱会': '演唱会',
  '原盘资源': '原盘', '4K原盘': '原盘', // 合并为原盘
  'REMUX': 'REMUX',
  '系列电影': '系列电影',
  '音乐': '音乐',
  '体育赛事': '体育',
  '少儿频道': '少儿频道',
  '每日更新': '连载',
  '合集': '合集',
};

export default function ImportPage() {
  const [mode, setMode] = useState<ImportMode>('zzmm');
  const [syncMode, setSyncMode] = useState(false);  // 泽泽妈妈专属：二次导入软删差异
  const [file, setFile] = useState<File | null>(null);
  const [docUrl, setDocUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'importing' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  // 2026-06-10: 快速导入 (CSV / 粘链接)
  const [quickText, setQuickText] = useState('');
  const [quickCategory, setQuickCategory] = useState('');
  const [quickImporting, setQuickImporting] = useState(false);

  const QUICK_SAMPLE = `狂飙,https://115.com/s/swXXX123,abc123
三体 S01E05,https://pan.baidu.com/s/1abcdef,def456
流浪地球2,https://115.com/s/swYYY456,
${'magnet:?'}xt=urn:btih:ABCDEF1234567890
庆余年2,https://115.com/s/swZZZ789,xyz789`;

  const doQuickImport = async () => {
    if (!quickText.trim()) { addLog('❌ 内容为空'); return; }
    setQuickImporting(true);
    addLog(`⚡ 快速导入: ${quickText.split('\n').filter(l => l.trim()).length} 行`);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
      const r = await fetch('/api/admin/import/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({ mode: 'paste', text: quickText, category: quickCategory || undefined }),
      });
      const d = await r.json();
      if (d.error) {
        addLog('❌ ' + d.error);
        return;
      }
      addLog(`✅ 解析 ${d.parsed} 条, 入库 ${d.imported}, 失败 ${d.failed}`);
      if (d.by_source) {
        const srcStr = Object.entries(d.by_source).map(([k, v]) => `${k}:${v}`).join(', ');
        addLog(`📊 来源分布: ${srcStr}`);
      }
      if (d.by_category) {
        const catStr = Object.entries(d.by_category).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', ');
        addLog(`📊 分类分布: ${catStr}`);
      }
      if (d.imported > 0) setQuickText(''); // 成功才清空
    } catch (e: any) {
      addLog('❌ 网络错误: ' + e.message);
    } finally {
      setQuickImporting(false);
    }
  };

  const addLog = useCallback((msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]), []);

  // 关键字匹配（fallback for sheet names not in the map）
  const mapCategory = (cat: string): string => {
    const c = (cat || '').trim();
    if (c.includes('系列电影')) return '系列电影';
    if (c.includes('华语') || c.includes('外语') || c.includes('国产') || c.includes('电影')) return '电影';
    if (c.includes('港台') || c.includes('韩日') || c.includes('欧美') || c.includes('剧集') || c.includes('电视剧')) return '剧集';
    if (c.includes('动画电影')) return '电影';
    if (c.includes('动漫')) return '动漫';
    if (c.includes('少儿')) return '少儿频道';
    if (c.includes('综艺')) return '综艺';
    if (c.includes('演唱会')) return '演唱会';
    if (c.includes('纪录片')) return '纪录片';
    if (c.includes('连载') || c.includes('每日更新')) return '连载';
    if (c.includes('原盘') || c.includes('4K')) return '原盘';
    if (c.includes('remux') || c.includes('REMUX')) return 'REMUX';
    if (c.includes('音乐')) return '音乐';
    if (c.includes('体育')) return '体育';
    if (c.includes('学习') || c.includes('教程')) return '学习资料';
    if (c.includes('合集')) return '合集';
    return c || '其他';
  };

  const parseZZMM = (wb: XLSX.WorkBook): any[] => {
    const items: any[] = [];
    wb.SheetNames.forEach(sheetName => {
      const sheet = wb.Sheets[sheetName];
      // 用 header:1 获取原始行数组（保持单元格地址信息）
      const h1Rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      if (!h1Rows || h1Rows.length < 2) return;
      const firstRow = h1Rows[0] || [];
      const dataRows = h1Rows.slice(1);

      // 自动识别列名（兼容中文表头）
      const headers = firstRow.map((c: any, i: number) => ({ col: i, name: String(c || '').trim() }));
      // 名称列：片名/标题（不是链接）
      const nameHeader = headers.find((h: any) => /名|片名|标题|title/i.test(h.name) && !/链接|链/i.test(h.name));
      // 链接列
      const linkHeader = headers.find((h: any) => /链接|链[^列]|link|url/i.test(h.name));
      const codeHeader = headers.find((h: any) => /码|password|提取|访问码/i.test(h.name));
      const sizeHeader = headers.find((h: any) => /大|size/i.test(h.name));

      const nameColIdx = nameHeader?.col ?? 0;
      const linkColIdx = linkHeader?.col ?? -1;
      const codeColIdx = codeHeader?.col ?? -1;
      const sizeColIdx = sizeHeader?.col ?? -1;

      // 优先用 map（null=跳过），其次用关键字 fallback，null=跳过此sheet
      const sheetCategory = ZZMM_SHEET_MAP[sheetName] ?? mapCategory(sheetName);
      if (sheetCategory === null) return; // 跳过非资源sheet
      const category = sheetCategory;
      addLog(`📋 Sheet[${sheetName}] → category[${category}] (${dataRows.length} rows)`);

      dataRows.forEach((row: any[], rowIdx: number) => {
        const name = String(row[nameColIdx] || '').trim();
        // 链接列：优先读原始单元格.w（超链接格式），否则读行列值
        let link = '';
        if (linkColIdx >= 0) {
          link = String(row[linkColIdx] || '').trim();
          if (!link) {
            // 超链接格式：需要从原始sheet单元格取值
            const colLetter = String.fromCharCode(65 + linkColIdx); // A=0,B=1...
            const cellAddr = colLetter + (rowIdx + 2);
            const rawCell = (sheet as any)[cellAddr];
            if (rawCell) {
              link = rawCell.w || rawCell.v || '';
            }
          }
        }
        let link_code = codeColIdx >= 0 ? String(row[codeColIdx] || '').trim() : '';
        if (!link_code) {
          const m = link.match(/[?&]password=([^\s&#]+)/i);
          if (m) link_code = m[1];
        }
        const size = sizeColIdx >= 0 ? String(row[sizeColIdx] || '').trim() : '';

        if (!name && !link) return;
        items.push({ name, link, link_code, source: '', category, size });
      });
    });
    return items;
  };

  const parseStandard = (wb: XLSX.WorkBook): any[] => {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
    if (!rows.length) return [];
    const headers = Object.keys(rows[0]);
    const nameCol = headers.find(h => /名|片名|标题|name/i.test(h));
    const linkCol = headers.find(h => /链|link|url/i.test(h));
    const codeCol = headers.find(h => /码|password|提取|密码/i.test(h));
    const sizeCol = headers.find(h => /大|size/i.test(h));
    const catCol = headers.find(h => /分类|category|type/i.test(h));

    return rows.map(row => {
      const link = linkCol ? row[linkCol] : '';
      let link_code = codeCol ? (row[codeCol] || '').toString() : '';
      if (!link_code) {
        const m = (link || '').toString().match(/[?&]password=([^\s&#]+)/);
        if (m) link_code = m[1];
      }
      return {
        name: nameCol ? row[nameCol] : '',
        link: link || '',
        link_code,
        source: '',
        category: catCol ? row[catCol] : '其他',
        size: sizeCol ? (row[sizeCol] || '').toString() : '',
      };
    }).filter(item => item.name || item.link);
  };

  const startImport = async () => {
    if (mode === 'doc') {
      if (!docUrl) {
        addLog('❌ 请输入线上文档地址');
        return;
      }
      setStatus('importing');
      addLog('🔗 正在拉取飞书文档数据...');
      try {
        const res = await fetch('/api/admin/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
          body: JSON.stringify({ mode: 'doc', docUrl }),
        });
        const data = await res.json();
        if (data.success) {
          setStatus('done');
          addLog(`✅ 导入完成，共 ${data.imported} 条`);
        } else {
          setStatus('error');
          addLog(`❌ ${data.error}`);
        }
      } catch (err: any) {
        setStatus('error');
        addLog(`❌ 错误: ${err.message}`);
      }
      return;
    }

    if (!file) return;
    setStatus('uploading');
    setLog([]);
    setResults([]);

    try {
      addLog('📖 读取文件...');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
      addLog(`✅ 文件读取完成，共 ${wb.SheetNames.length} 个 sheet`);

      let items: any[] = [];
      let actualMode: string = mode;
      if (mode === 'zzmm') {
        items = parseZZMM(wb);
        addLog(`📋 泽泽妈妈模式：解析到 ${items.length} 条数据`);
        if (syncMode) {
          actualMode = 'zezhe-sync';
          addLog('🔄 已启用增量同步：本次 Excel 中未出现的旧链接将被软删除（status=deleted）');
        }
      } else {
        items = parseStandard(wb);
        addLog(`📋 标准 Excel 模式：解析到 ${items.length} 条数据`);
      }

      if (!items.length) {
        setStatus('error');
        addLog('❌ 未解析到任何有效数据，请检查文件格式');
        return;
      }

      addLog(`📊 开始${syncMode ? '增量同步' : '分批导入'} ${items.length} 条...`);
      setStatus('importing');
      setProgress(50);

      // 增量同步模式：必须一次性发完（分批会导致 diff 算错，把每批外的全删了）
      if (syncMode) {
        try {
          const res = await fetch('/api/admin/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
            body: JSON.stringify({ items, mode: 'zezhe-sync' }),
          });
          const result = await res.json();
          if (result.success) {
            setProgress(100);
            setStatus('done');
            addLog(`\n🎉 增量同步完成！`);
            addLog(`📥 本次 Excel 共: ${result.total} 条`);
            addLog(`✅ 新增: ${result.inserted} 条`);
            addLog(`🗑️ 软删除: ${result.deleted} 条（不再出现的旧链接）`);
            addLog(`⏸️ 不变: ${result.unchanged} 条`);
            if (result.failed > 0) addLog(`⚠️ 失败: ${result.failed} 条`);
            setResults([{ batch: 1, imported: result.inserted, failed: result.failed, total: result.total }]);
          } else {
            setStatus('error');
            addLog(`❌ 同步失败: ${result.error}`);
            if (result.error?.includes('ENABLE_ZEZHE_SYNC')) {
              addLog(`💡 提示：请在 Vercel 项目环境变量中添加 ENABLE_ZEZHE_SYNC=true`);
            }
          }
        } catch (err: any) {
          setStatus('error');
          addLog(`❌ 网络错误: ${err.message}`);
        }
        return;
      }

      const BATCH = 200;
      let totalImported = 0;
      let totalFailed = 0;

      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(items.length / BATCH);
        setProgress(Math.round((i / items.length) * 100));
        addLog(`⏳ 批次 ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH, items.length)})`);

        try {
          const res = await fetch('/api/admin/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
            body: JSON.stringify({ items: batch, mode: actualMode }),
          });
          const result = await res.json();
          if (result.success) {
            totalImported += result.imported;
            totalFailed += result.failed || 0;
            setResults(prev => [...prev, { batch: batchNum, imported: result.imported, failed: result.failed || 0, total: items.length }]);
            addLog(`✅ 批次 ${batchNum} 完成：导入 ${result.imported} 条`);
          } else {
            addLog(`⚠️ 批次 ${batchNum}: ${result.error}`);
            totalFailed += batch.length;
          }
        } catch (err: any) {
          addLog(`❌ 批次 ${batchNum} 网络错误: ${err.message}`);
          totalFailed += batch.length;
        }
        await new Promise(r => setTimeout(r, 500));
      }

      setProgress(100);
      setStatus('done');
      addLog(`\n🎉 全部完成！`);
      addLog(`✅ 成功导入: ${totalImported} 条`);
      if (totalFailed > 0) addLog(`⚠️ 失败: ${totalFailed} 条`);
    } catch (err: any) {
      setStatus('error');
      addLog(`❌ 错误: ${err.message}`);
    }
  };

  const handleFile = (f: File) => {
    setFile(f);
    setStatus('idle');
    setLog([]);
    setResults([]);
    setProgress(0);
    addLog(`已选择文件: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.location.href = '/admin'} className="p-2 hover:bg-white/10 rounded-lg transition">←</button>
          <div>
            <h1 className="text-2xl font-bold">📤 数据导入</h1>
            <p className="text-sm text-white/40">支持三种导入模式</p>
          </div>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-3 mb-6">
          {MODES.map(m => (
            <button
              key={m.key}
              onClick={() => { setMode(m.key); setFile(null); setLog([]); setResults([]); setProgress(0); setStatus('idle'); setSyncMode(false); }}
              className={`flex-1 py-3 px-4 rounded-xl border transition text-left ${
                mode === m.key
                  ? 'border-violet-500 bg-violet-500/10 text-white'
                  : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
              }`}
            >
              <div className="text-xl mb-1">{m.icon}</div>
              <div className="font-medium text-sm">{m.label}</div>
              <div className="text-xs text-white/40 mt-1">{m.desc}</div>
            </button>
          ))}
        </div>

        {/* 泽泽妈妈模式：二次导入同步开关 */}
        {mode === 'zzmm' && !file && (
          <div className="mb-6 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={syncMode}
                onChange={e => setSyncMode(e.target.checked)}
                className="mt-1 w-5 h-5 accent-amber-500"
              />
              <div className="flex-1">
                <div className="font-medium text-amber-200">🔄 启用增量同步（二次导入）</div>
                <div className="text-xs text-white/60 mt-1">
                  开启后，本次 Excel 中<strong className="text-amber-300">不再出现的旧链接会被软删除</strong>（status=deleted，数据保留可恢复）。
                  第一次导入时<strong className="text-amber-300">不要勾选</strong>，避免误删历史数据。
                </div>
              </div>
            </label>
          </div>
        )}

        {/* File Upload Area */}
        {mode !== 'doc' && (
          <div
            className={`border-2 border-dashed rounded-2xl p-8 text-center mb-6 transition cursor-pointer ${
              file ? 'border-violet-500 bg-violet-500/10' : 'border-white/20 hover:border-white/40'
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
            {file ? (
              <div>
                <div className="text-4xl mb-2">📄</div>
                <div className="font-medium">{file.name}</div>
                <div className="text-sm text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                <div className="mt-3 text-violet-400 text-sm">点击或拖拽替换文件</div>
              </div>
            ) : (
              <div>
                <div className="text-4xl mb-2">📤</div>
                <div className="text-white/60">点击选择或拖拽 Excel 文件到这里</div>
                <div className="text-sm text-white/40 mt-2">
                  {mode === 'zzmm'
                    ? '支持 .xlsx（多 sheet 自动识别）'
                    : '支持 .xlsx / .xls，固定表头格式'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 线上文档 URL 输入 */}
        {mode === 'doc' && (
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-5 mb-6">
            <h3 className="font-medium mb-3">🔗 飞书文档地址</h3>
            <p className="text-xs text-white/40 mb-3">粘贴飞书文档 URL，格式如 https://xxx.feishu.cn/docx/xxx</p>
            <input
              type="url"
              value={docUrl}
              onChange={e => setDocUrl(e.target.value)}
              placeholder="https://xxx.feishu.cn/docx/xxx"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
            />
          </div>
        )}

        {/* Start Button */}
        {((file && status === 'idle') || (mode === 'doc' && status === 'idle')) && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={startImport}
            className="w-full py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition"
          >
            ▶️ 开始导入
          </motion.button>
        )}

        {/* Progress */}
        {(status === 'uploading' || status === 'importing') && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span>{status === 'uploading' ? '读取文件...' : '导入中...'}</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* Results */}
        {status === 'done' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-green-500/20 border border-green-500/30 rounded-xl p-5 mb-6">
            <div className="text-green-400 font-bold text-lg mb-2">✅ 导入完成</div>
            <div className="text-sm text-white/70">
              共处理 {results.reduce((a, r) => a + r.imported + r.failed, 0)} 条，分 {results.length} 批次
            </div>
          </motion.div>
        )}

        {/* 2026-06-10: 快速导入 - CSV / 粘链接 (无需 Excel, 纯文本) */}
        <div className="bg-[#12121a] rounded-xl border border-white/5 p-4 mb-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="text-sm font-medium">⚡ 快速导入 (粘 CSV / 粘链接)</h3>
            <div className="text-xs text-white/40">
              支持: <code className="text-violet-300">片名,链接,提取码</code> (CSV/TSV/空格) ·
              自动识别 115/百度/磁力/ed2k
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-2">
            <select
              value={quickCategory}
              onChange={e => setQuickCategory(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs"
            >
              <option value="">自动猜分类</option>
              <option value="电影">电影</option>
              <option value="剧集">剧集</option>
              <option value="动漫">动漫</option>
              <option value="纪录片">纪录片</option>
              <option value="综艺">综艺</option>
              <option value="演唱会">演唱会</option>
              <option value="原盘">原盘</option>
              <option value="REMUX">REMUX</option>
              <option value="连载">连载</option>
              <option value="合集">合集</option>
              <option value="少儿频道">少儿频道</option>
              <option value="音乐">音乐</option>
              <option value="体育">体育</option>
            </select>
            <button
              type="button"
              onClick={() => { setQuickText(QUICK_SAMPLE); }}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg"
            >
              📋 填示例
            </button>
            <button
              type="button"
              onClick={() => setQuickText('')}
              className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg"
            >
              🗑️ 清空
            </button>
          </div>

          <textarea
            value={quickText}
            onChange={e => setQuickText(e.target.value)}
            placeholder={`每行一条: 片名,链接,提取码\n狂飙,https://115.com/s/swXXX,abc123\n三体 S01E05,https://pan.baidu.com/s/1xxx,def456\n磁力链接: ${'magnet:?'}xt=urn:btih:...`}
            className="w-full h-40 bg-black/30 border border-white/10 rounded-lg p-3 text-xs font-mono text-white/90 placeholder-white/20 focus:outline-none focus:border-violet-500/50"
          />

          <div className="flex items-center justify-between mt-2 text-xs text-white/50">
            <div>当前: <b className="text-white">{quickText.split('\n').filter(l => l.trim()).length}</b> 行</div>
            <button
              type="button"
              onClick={doQuickImport}
              disabled={quickImporting || !quickText.trim()}
              className="px-4 py-1.5 bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 disabled:opacity-50 rounded-lg font-medium"
            >
              {quickImporting ? '导入中...' : '⚡ 快速导入'}
            </button>
          </div>
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <div className="text-sm font-medium mb-3 text-white/60">📋 执行日志</div>
            <div className="font-mono text-xs space-y-1 max-h-80 overflow-y-auto">
              {log.map((line, i) => (
                <div key={i} className={line.includes('❌') ? 'text-red-400' : line.includes('✅') ? 'text-green-400' : 'text-white/60'}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Admin Key - 已临时禁用
        {showKeyInput && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 bg-[#12121a] rounded-xl p-5 border border-white/5">
            <h3 className="font-medium mb-3">🔑 管理员密钥</h3>
            <p className="text-xs text-white/40 mb-3">在 Vercel 环境变量中设置的 ADMIN_SECRET 值</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={adminKey}
                onChange={e => setAdminKey(e.target.value)}
                placeholder="输入管理员密钥..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
              />
              <button
                onClick={() => { if (adminKey) setShowKeyInput(false); }}
                disabled={!adminKey}
                className="px-4 bg-violet-600 rounded-lg disabled:opacity-50 hover:bg-violet-500 transition"
              >
                确认
              </button>
            </div>
          </motion.div>
        )}
        */}
      </div>
    </div>
  );
}