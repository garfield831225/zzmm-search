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

// 泽泽妈妈 sheet → category 映射（完整21个sheet映射）
const ZZMM_SHEET_MAP: Record<string, string> = {
  '电影': '电影', '外语电影': '电影', '华语电影': '电影',
  '国产剧': '剧集', '欧美剧': '剧集', '韩日剧': '剧集', '港台剧': '剧集',
  '动画电影': '电影',
  '动漫': '动漫',
  '少儿频道': '少儿频道',
  '综艺': '综艺',
  '演唱会': '演唱会',
  '纪录片': '纪录片',
  '连载': '连载',
  '每日更新': '连载',
  '原盘资源': '原盘', '4K原盘': '原盘',
  'REMUX': 'REMUX',
  '系列电影': '系列电影',
  '音乐': '音乐',
  '体育赛事': '体育',
  '合集': '合集',
};

export default function ImportPage() {
  const [mode, setMode] = useState<ImportMode>('zzmm');
  const [file, setFile] = useState<File | null>(null);
  const [docUrl, setDocUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'importing' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

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
      const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
      if (!rows.length) return;
      // 自动识别列名（兼容中文表头）
      const headers = Object.keys(rows[0]);
      const nameCol = headers.find(h => /名|片名|标题|title/i.test(h));
      const linkCol = headers.find(h => /链|link|url/i.test(h));
      const codeCol = headers.find(h => /码|password|提取|密码/i.test(h));
      const sizeCol = headers.find(h => /大|size/i.test(h));

      // 优先用 map，其次用关键字 fallback
      const category = ZZMM_SHEET_MAP[sheetName] || mapCategory(sheetName);

      rows.forEach(row => {
        const rawLink: string = (nameCol ? row[nameCol] : '') || '';
        const linkStr: string = (linkCol ? row[linkCol] : '') || '';
        const name = rawLink || linkStr;
        const link = linkCol ? row[linkCol] : '';
        let link_code = codeCol ? (row[codeCol] || '').toString() : '';

        // 如果链接里已经有 password 参数，优先从 URL 提取
        if (!link_code) {
          const m = link.match(/[?&]password=([^\s&#]+)/);
          if (m) link_code = m[1];
        }

        const size = sizeCol ? (row[sizeCol] || '').toString() : '';

        // 过滤空行
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
      if (mode === 'zzmm') {
        items = parseZZMM(wb);
        addLog(`📋 泽泽妈妈模式：解析到 ${items.length} 条数据`);
      } else {
        items = parseStandard(wb);
        addLog(`📋 标准 Excel 模式：解析到 ${items.length} 条数据`);
      }

      if (!items.length) {
        setStatus('error');
        addLog('❌ 未解析到任何有效数据，请检查文件格式');
        return;
      }

      addLog(`📊 开始分批导入 ${items.length} 条...`);
      setStatus('importing');

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
            body: JSON.stringify({ items: batch, mode }),
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
              onClick={() => { setMode(m.key); setFile(null); setLog([]); setResults([]); setProgress(0); setStatus('idle'); }}
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