'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';

export default function ZzmmImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [adminKey, setAdminKey] = useState('');
  const [sheetCount, setSheetCount] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const detectSource = (link: string): string => {
    if (!link) return '115';
    if (link.includes('115.com') || link.includes('115.cn') || link.includes('115cdn.com')) return '115';
    if (link.includes('pan.baidu.com')) return 'baidu';
    if (link.includes('quark.cn')) return 'quark';
    if (link.includes('aliyundrive.com')) return 'aliyun';
    if (link.includes('123pan.com')) return '123';
    if (link.includes('cloud.189.cn')) return 'tianyi';
    if (link.includes('magnet:')) return 'magnet';
    if (link.includes('ed2k://')) return 'ed2k';
    if (link.includes('thunder:') || link.includes('xunlei')) return 'thunder';
    return '115';
  };

  const mapCategory = (cat: string): string => {
    const c = (cat || '').trim();
    if (c.includes('系列电影')) return '系列电影';
    if (c.includes('华语') || c.includes('外语') || c.includes('国产') || c.includes('电影')) return '电影';
    if (c.includes('港台') || c.includes('韩日') || c.includes('欧美') || c.includes('剧集') || c.includes('电视剧')) return '剧集';
    if (c.includes('动画电影')) return '电影';  // 动画电影归为电影
    if (c.includes('动漫')) return '动漫';  // 动漫（番剧）归为动漫
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

  const parseSheet = (sheetName: string, rawRows: any[][]) => {
    if (!rawRows || rawRows.length < 2) return null;

    // 第一行是标题
    const firstRow: any[] = rawRows[0] || [];
    const firstRowStr: string = firstRow.map(c => String(c || '').trim()).join('|');
    const colCount = firstRow.length;

    // 判断是否是数据 sheet
    if (!firstRowStr.includes('名称') && !firstRowStr.includes('大小') &&
      !firstRowStr.includes('链接') && !firstRowStr.includes('title') &&
      !firstRowStr.includes('link')) return null;

    // 确定分类
    let category = '';
    const allCategoryWords = ['系列电影', '华语', '外语', '国产', '韩日', '港台', '欧美', '剧集', '电视剧', '动漫', '动画电影', '少儿频道', '综艺', '演唱会', '纪录片', '连载', '每日更新', '原盘', '4K', 'REMUX', '音乐', '体育', '体育赛事', '学习', '合集', '电影'];
    for (const w of allCategoryWords) {
      if (firstRowStr.includes(w) || sheetName.includes(w)) {
        category = mapCategory(w);
        break;
      }
    }
    if (!category) category = mapCategory(sheetName);

    // 数据行（跳过标题）
    const dataRows = rawRows.slice(1).filter(row => row && row.length > 0);
    if (!dataRows.length) return null;

    // 找链接列
    let linkCol = -1;
    let codeCol = -1;

    // 从标题行找
    for (let c = 0; c < colCount; c++) {
      const h = String(firstRow[c] || '').trim();
      if (h.includes('链接')) {
        linkCol = c;
        if (c + 1 < colCount && String(firstRow[c + 1] || '').trim().includes('密码')) codeCol = c + 1;
        break;
      }
      if (h.includes('密码') && c + 1 < colCount && String(firstRow[c + 1] || '').trim().includes('链接')) {
        codeCol = c;
        linkCol = c + 1;
        break;
      }
    }

    // 标题没找到就扫描数据
    if (linkCol < 0) {
      outer:
      for (let c = 0; c < colCount; c++) {
        for (let r = 0; r < Math.min(5, dataRows.length); r++) {
          const val = String((dataRows[r] || [])[c] || '').trim();
          if (val && (val.includes('115.com') || val.includes('115.cn') || val.includes('115cdn.com') ||
            val.includes('pan.baidu') || val.includes('quark.cn') || val.includes('aliyundrive') ||
            val.includes('123pan') || val.includes('cloud.189') || val.includes('magnet:') ||
            val.includes('ed2k://') || val.includes('thunder:'))) {
            linkCol = c;
            break outer;
          }
        }
      }
      if (linkCol > 0 && String(firstRow[linkCol - 1] || '').trim().includes('密码')) codeCol = linkCol - 1;
    }

    if (linkCol < 0) return null;

    // 名称列：链接左边第一个有标题的列
    let nameCol = 0;
    if (linkCol > 0) {
      for (let c = 0; c < linkCol; c++) {
        if (String(firstRow[c] || '').trim()) { nameCol = c; break; }
      }
    } else {
      nameCol = 1;
    }

    // 大小列
    let sizeCol = -1;
    for (let c = 0; c < colCount; c++) {
      if (String(firstRow[c] || '').trim().includes('大小')) { sizeCol = c; break; }
    }

    // 分类列
    let categoryCol = -1;
    for (let c = 0; c < colCount; c++) {
      const h = String(firstRow[c] || '').trim();
      if (h.includes('分类') && h !== '分类') { categoryCol = c; break; }
    }

    // 解析数据
    const items: any[] = [];
    for (const row of dataRows) {
      const link = String(row[linkCol] || '').trim();
      const name = String(row[nameCol] || '').trim();
      const code = codeCol >= 0 ? String(row[codeCol] || '').trim() : '';
      const size = sizeCol >= 0 ? String(row[sizeCol] || '').trim() : '';
      const rawCategory = categoryCol >= 0 ? String(row[categoryCol] || '').trim() : '';
      const effectiveCategory = rawCategory ? mapCategory(rawCategory) : category;
      if (name && link) {
        items.push({ name, link, link_code: code, size, category: effectiveCategory, source: detectSource(link) });
      }
    }

    return { name: sheetName, category, items };
  };

  const parseExcel = async (f: File) => {
    addLog('📖 读取 Excel 文件...');
    const XLSX = (window as any).XLSX;
    if (!XLSX) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('加载 xlsx 库失败'));
        document.head.appendChild(s);
      });
    }
    const data = await f.arrayBuffer();
    const wb = (window as any).XLSX.read(data, { type: 'array' });
    const sheets: { name: string; category: string; items: any[] }[] = [];

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rawRows: any[][] = (window as any).XLSX.utils.sheet_to_json(sheet, { header: 1 });
      const result = parseSheet(sheetName, rawRows);
      if (result && result.items.length > 0) {
        sheets.push(result);
        addLog(`📋 Sheet「${result.name}」(分类=${result.category}): ${result.items.length} 条`);
      }
    }

    return { sheets };
  };

  const startImport = async () => {
    if (!file || !adminKey) return;
    setStatus('importing');
    setLog([]);
    setProgress(0);

    try {
      const { sheets } = await parseExcel(file);
      if (!sheets.length) {
        setStatus('error');
        addLog('❌ 未找到任何有效数据 Sheet');
        return;
      }

      setSheetCount(sheets.length);
      const totalItems = sheets.reduce((sum, s) => sum + s.items.length, 0);
      setTotalRows(totalItems);
      addLog(`\n📊 共 ${sheets.length} 个 Sheet，${totalItems} 条数据，开始分批导入...`);
      setProgress(5);

      let totalImported = 0;
      let totalFailed = 0;
      let processedItems = 0;

      const BATCH = 200;
      for (const sheet of sheets) {
        for (let i = 0; i < sheet.items.length; i += BATCH) {
          const batch = sheet.items.slice(i, i + BATCH);
          processedItems += batch.length;
          const progressVal = Math.round((5 + (processedItems / totalItems * 90)));
          setProgress(progressVal);
          const batchNum = Math.floor(i / BATCH) + 1;
          const totalBatches = Math.ceil(sheet.items.length / BATCH);
          addLog(`⏳「${sheet.name}」批次${batchNum}/${totalBatches}`);

          try {
            const res = await fetch('/api/admin/import', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
              body: JSON.stringify({ items: batch }),
            });
            const result = await res.json();
            if (result.success) {
              totalImported += result.imported;
              totalFailed += result.failed || 0;
              addLog(`✅ 导入 ${result.imported} 条`);
            } else {
              addLog(`⚠️ ${result.error}`);
              totalFailed += batch.length;
            }
          } catch (err: any) {
            addLog(`❌ ${err.message}`);
            totalFailed += batch.length;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      setProgress(100);
      setStatus('done');
      addLog(`\n🎉 完成！${sheets.length} 个分类，成功: ${totalImported} / 失败: ${totalFailed}`);
    } catch (err: any) {
      setStatus('error');
      addLog(`❌ ${err.message}`);
    }
  };

  const handleFile = (f: File) => {
    const ext = f.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setStatus('error');
      setLog(['❌ 只支持 .xlsx 和 .xls']);
      return;
    }
    setFile(f);
    setStatus('idle');
    setLog([]);
    setProgress(0);
    setSheetCount(0);
    setTotalRows(0);
    addLog(`📄 已选择: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">🏠 泽泽妈妈专属导入</h2>
      <div className="bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 mb-6">
        <p className="text-sm text-violet-300">🎯 自动识别所有 Sheet，每个 Sheet 对应一个分类，一次性全部导入。</p>
        <p className="text-xs text-white/50 mt-2">自动识别列：名称/链接/提取码/大小，自动识别115/百度/阿里/磁力等来源</p>
      </div>
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5 mb-6">
        <h3 className="font-medium mb-2">🔑 管理员密钥</h3>
        <input type="password" value={adminKey} onChange={(e) => setAdminKey(e.target.value)}
          placeholder="输入密钥..." className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-500" />
      </div>
      <div className={`border-2 border-dashed rounded-2xl p-8 text-center mb-6 transition cursor-pointer ${file ? 'border-violet-500 bg-violet-500/10' : 'border-white/20 hover:border-white/40'}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
        {file ? (
          <div><div className="text-4xl mb-2">📄</div><div className="font-medium">{file.name}</div><div className="text-sm text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</div></div>
        ) : (
          <div><div className="text-4xl mb-2">🏠</div><div className="text-white/60">点击选择或拖拽 Excel 文件</div><div className="text-sm text-white/40 mt-2">支持多 Sheet 文档</div></div>
        )}
      </div>
      {file && status === 'idle' && (
        <motion.button initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
          onClick={startImport} disabled={!adminKey}
          className="w-full py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition disabled:opacity-50">
          ▶️ 开始导入
        </motion.button>
      )}
      {status === 'importing' && (
        <div className="mt-6">
          <div className="flex justify-between text-sm mb-2">
            <span>导入中... {sheetCount > 0 ? `(已扫描 ${sheetCount} 个 Sheet)` : ''}</span><span>{progress}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {status === 'done' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 bg-green-500/20 border border-green-500/30 rounded-xl p-5">
          <div className="text-green-400 font-bold">✅ 导入完成</div>
          {totalRows > 0 && <div className="text-sm text-white/60 mt-1">共 {totalRows} 条，分布 {sheetCount} 个分类</div>}
        </motion.div>
      )}
      {status === 'error' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-6 bg-red-500/20 border border-red-500/30 rounded-xl p-5">
          <div className="text-red-400 font-bold">❌ 导入失败</div>
        </motion.div>
      )}
      {log.length > 0 && (
        <div className="mt-6 bg-[#12121a] rounded-xl border border-white/5 p-4">
          <div className="text-sm font-medium mb-3 text-white/60">📋 日志</div>
          <div className="font-mono text-xs space-y-1 max-h-80 overflow-y-auto">
            {log.map((line, i) => (
              <div key={i} className={line.includes('❌') ? 'text-red-400' : line.includes('✅') ? 'text-green-400' : 'text-white/60'}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}