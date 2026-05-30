'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface ImportResult {
  batch: number;
  imported: number;
  failed: number;
}

export default function ImportPanel() {
  const [mode, setMode] = useState<'excel' | 'doc'>('excel');
  const [file, setFile] = useState<File | null>(null);
  const [docUrl, setDocUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'importing' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  // 检测来源类型
  const detectSource = (link: string): string => {
    if (!link) return '115';
    if (link.includes('115.com') || link.includes('115.cn')) return '115';
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
    const c = (cat || '').toLowerCase();
    if (c.includes('音乐')) return '音乐';
    if (c.includes('体育')) return '体育';
    if (c.includes('学习') || c.includes('教程')) return '学习资料';
    if (c.includes('合集')) return '合集';
    if (c.includes('系列电影')) return '系列电影';
    if (c.includes('电影')) return '电影';
    if (c.includes('剧集') || c.includes('电视剧')) return '剧集';
    if (c.includes('动漫') || c.includes('动画')) return '动漫';
    if (c.includes('少儿')) return '少儿频道';
    if (c.includes('综艺')) return '综艺';
    if (c.includes('演唱会')) return '演唱会';
    if (c.includes('纪录片')) return '纪录片';
    if (c.includes('连载') || c.includes('每日更新')) return '连载';
    if (c.includes('原盘') || c.includes('4k') || c.includes('4K')) return '原盘';
    if (c.includes('remux')) return 'REMUX';
    return c || '其他';
  };

  // 解析 Excel
  const parseExcel = async (f: File): Promise<any[]> => {
    addLog('📖 读取 Excel 文件...');

    // 使用 XLSX CDN
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
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = (window as any).XLSX.utils.sheet_to_json(sheet);

    addLog(`✅ 解析完成，共 ${json.length} 行`);
    return json;
  };

  // 检测 Excel 列名
  const detectColumns = (rows: any[]): {
    nameCol: string; linkCol: string; codeCol: string;
    sizeCol: string; categoryCol: string; typeCol: string;
  } => {
    if (rows.length === 0) return { nameCol: '', linkCol: '', codeCol: '', sizeCol: '', categoryCol: '', typeCol: '' };

    const cols = Object.keys(rows[0]);
    const lower = cols.map(c => c.toLowerCase());

    const find = (...keywords: string[]) => {
      for (const kw of keywords) {
        const idx = lower.findIndex(c => c.includes(kw));
        if (idx >= 0) return cols[idx];
      }
      return '';
    };

    return {
      nameCol: find('名称', 'name', '标题', 'title', '文件名') || cols[0],
      linkCol: find('链接', 'link', 'url', '地址') || cols[1],
      codeCol: find('提取码', 'code', '密码', 'password') || '',
      sizeCol: find('大小', 'size', '容量') || '',
      categoryCol: find('分类', 'category', '类型') || '',
      typeCol: find('画质', 'type', '分辨率', 'quality') || '',
    };
  };

  // Excel 导入流程
  const importExcel = async (f: File) => {
    if (!adminKey) {
      addLog('❌ 请先输入管理员密钥');
      return;
    }

    setStatus('importing');
    setLog([]);
    setResults([]);

    try {
      const rows = await parseExcel(f);
      if (!rows.length) {
        setStatus('error');
        addLog('❌ Excel 无数据');
        return;
      }

      const cols = detectColumns(rows);
      addLog(`📋 检测到列：名称=${cols.nameCol} 链接=${cols.linkCol}`);

      // 转换为标准格式
      const items = rows.map((row: any) => ({
        name: row[cols.nameCol] || '',
        link: row[cols.linkCol] || '',
        link_code: row[cols.codeCol] || '',
        size: row[cols.sizeCol] || '',
        category: mapCategory(row[cols.categoryCol] || ''),
        source: detectSource(row[cols.linkCol] || ''),
      })).filter((item: any) => item.name && item.link);

      addLog(`📊 有效数据: ${items.length} 条`);
      setProgress(10);

      // 分批导入
      const BATCH = 200;
      let totalImported = 0;
      let totalFailed = 0;

      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(items.length / BATCH);

        setProgress(10 + Math.round((i / items.length) * 85));
        addLog(`⏳ 批次 ${batchNum}/${totalBatches} (${i + 1}-${Math.min(i + BATCH, items.length)})`);

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
            setResults((prev) => [...prev, { batch: batchNum, imported: result.imported, failed: result.failed || 0 }]);
            addLog(`✅ 批次 ${batchNum}: ${result.imported} 条`);
          } else {
            addLog(`⚠️ 批次 ${batchNum}: ${result.error}`);
            totalFailed += batch.length;
          }
        } catch (err: any) {
          addLog(`❌ 批次 ${batchNum} 错误: ${err.message}`);
          totalFailed += batch.length;
        }

        await new Promise((r) => setTimeout(r, 300));
      }

      setProgress(100);
      setStatus('done');
      addLog(`\n🎉 完成！成功: ${totalImported} / 失败: ${totalFailed}`);
    } catch (err: any) {
      setStatus('error');
      addLog(`❌ 错误: ${err.message}`);
    }
  };

  // 线上文档导入
  const importDoc = async () => {
    if (!adminKey) { addLog('❌ 请先输入管理员密钥'); return; }
    if (!docUrl) { addLog('❌ 请输入文档链接'); return; }

    const isTencent = docUrl.includes('docs.qq.com') || docUrl.includes('doc.weqq.com');
    const isWps = docUrl.includes('kdocs.cn') || docUrl.includes('qing.wps.cn');

    if (!isTencent && !isWps) {
      addLog('❌ 只支持腾讯文档或金山文档链接');
      return;
    }

    setStatus('importing');
    setLog([`🔗 文档类型: ${isTencent ? '腾讯文档' : '金山文档'}`]);

    try {
      addLog('⏳ 正在抓取文档...');
      const res = await fetch('/api/admin/doc-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
        body: JSON.stringify({ url: docUrl }),
      });

      const data = await res.json();

      if (data.success) {
        addLog(`✅ 获取到 ${data.count} 条数据`);
        // 触发导入
        const importRes = await fetch('/api/admin/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
          body: JSON.stringify({ items: data.items }),
        });
        const importData = await importRes.json();

        if (importData.success) {
          setProgress(100);
          setStatus('done');
          addLog(`\n🎉 导入完成！共 ${importData.imported} 条`);
        } else {
          setStatus('error');
          addLog(`❌ 导入失败: ${importData.error}`);
        }
      } else {
        setStatus('error');
        addLog(`❌ 抓取失败: ${data.error}`);
      }
    } catch (err: any) {
      setStatus('error');
      addLog(`❌ 错误: ${err.message}`);
    }
  };

  const handleFile = (f: File) => {
    const ext = f.name.toLowerCase();
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setStatus('error');
      setLog(['❌ 只支持 .xlsx 和 .xls 格式']);
      return;
    }
    setFile(f);
    setStatus('idle');
    setLog([]);
    setResults([]);
    setProgress(0);
    addLog(`📄 已选择: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
  };

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">📤 数据导入</h2>

      {/* Admin Key */}
      <div className="bg-[#12121a] rounded-xl p-5 border border-white/5 mb-6">
        <h3 className="font-medium mb-2">🔑 管理员密钥</h3>
        <p className="text-xs text-white/40 mb-3">Vercel 环境变量 ADMIN_SECRET 的值</p>
        <input
          type="password"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          placeholder="输入密钥..."
          className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
        />
      </div>

      {/* Mode Tabs */}
      <div className="flex gap-2 mb-6 bg-white/5 p-1 rounded-xl">
        <button
          onClick={() => setMode('excel')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
            mode === 'excel' ? 'bg-violet-600 text-white' : 'text-white/60'
          }`}
        >
          📊 Excel 上传
        </button>
        <button
          onClick={() => setMode('doc')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
            mode === 'doc' ? 'bg-violet-600 text-white' : 'text-white/60'
          }`}
        >
          🔗 线上文档链接
        </button>
      </div>

      {/* Excel Mode */}
      {mode === 'excel' && (
        <>
          <div
            className={`border-2 border-dashed rounded-2xl p-8 text-center mb-4 transition cursor-pointer ${
              file ? 'border-violet-500 bg-violet-500/10' : 'border-white/20 hover:border-white/40'
            }`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) handleFile(f);
            }}
          >
            <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            {file ? (
              <div>
                <div className="text-4xl mb-2">📄</div>
                <div className="font-medium">{file.name}</div>
                <div className="text-sm text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              </div>
            ) : (
              <div>
                <div className="text-4xl mb-2">📊</div>
                <div className="text-white/60">点击选择或拖拽 Excel 文件</div>
                <div className="text-sm text-white/40 mt-2">支持 .xlsx .xls 格式</div>
              </div>
            )}
          </div>

          {file && status === 'idle' && (
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => importExcel(file)}
              disabled={!adminKey}
              className="w-full py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition disabled:opacity-50"
            >
              ▶️ 开始导入 Excel
            </motion.button>
          )}
        </>
      )}

      {/* Doc Mode */}
      {mode === 'doc' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-white/60 mb-2">文档链接</label>
            <input
              type="url"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
              placeholder="粘贴腾讯文档或金山文档的可查看链接..."
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500"
            />
          </div>
          <div className="text-xs text-white/40 bg-white/5 rounded-lg p-3">
            <p>支持以下格式：</p>
            <p>• 腾讯文档：docs.qq.com 开头的链接</p>
            <p>• 金山文档：kdocs.cn 开头的链接</p>
            <p>⚠️ 必须是有"可查看"权限的链接</p>
          </div>
          <button
            onClick={importDoc}
            disabled={!adminKey || !docUrl || status === 'importing'}
            className="w-full py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition disabled:opacity-50"
          >
            🔗 抓取并导入
          </button>
        </div>
      )}

      {/* Progress */}
      {(status === 'importing') && (
        <div className="mt-6">
          <div className="flex justify-between text-sm mb-2">
            <span>导入中...</span><span>{progress}%</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2">
            <div className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {/* Done */}
      {status === 'done' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="mt-6 bg-green-500/20 border border-green-500/30 rounded-xl p-5">
          <div className="text-green-400 font-bold">✅ 导入完成</div>
        </motion.div>
      )}

      {/* Log */}
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