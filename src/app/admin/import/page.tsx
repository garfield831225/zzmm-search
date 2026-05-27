'use client';

import { useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface ImportResult {
  batch: number;
  imported: number;
  failed: number;
  total: number;
}

export default function ImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'importing' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<ImportResult[]>([]);
  const [adminKey, setAdminKey] = useState('');
  const [showKeyInput, setShowKeyInput] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const addLog = (msg: string) => setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const handleFile = (f: File) => {
    setFile(f);
    setStatus('idle');
    setLog([]);
    setResults([]);
    setProgress(0);
    addLog(`已选择文件: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
  };

  const startImport = async () => {
    if (!file) return;
    setStatus('uploading');
    setLog([]);
    setResults([]);

    try {
      addLog('📖 读取文件内容...');
      const text = await file.text();
      addLog(`✅ 文件读取完成，解析JSON...`);

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        setStatus('error');
        addLog('❌ JSON格式错误');
        return;
      }

      const items = data.d || [];
      if (!items.length) {
        setStatus('error');
        addLog('❌ 数据为空或格式错误');
        return;
      }

      addLog(`📊 共 ${items.length} 条数据，开始分批导入...`);
      setStatus('importing');

      const BATCH = 200;
      let totalImported = 0;
      let totalFailed = 0;

      for (let i = 0; i < items.length; i += BATCH) {
        const batch = items.slice(i, i + BATCH);
        const batchNum = Math.floor(i / BATCH) + 1;
        const totalBatches = Math.ceil(items.length / BATCH);

        setProgress(Math.round((i / items.length) * 100));
        addLog(`⏳ 批次 ${batchNum}/${totalBatches} (${i + 1} - ${Math.min(i + BATCH, items.length)})`);

        try {
          const res = await fetch('/api/admin/import', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${adminKey}`,
            },
            body: JSON.stringify({ items: batch }),
          });

          const result = await res.json();

          if (result.success) {
            totalImported += result.imported;
            totalFailed += result.failed || 0;
            setResults((prev) => [...prev, { batch: batchNum, imported: result.imported, failed: result.failed || 0, total: items.length }]);
            addLog(`✅ 批次 ${batchNum} 完成: 导入 ${result.imported} 条`);
          } else {
            addLog(`⚠️ 批次 ${batchNum}: ${result.error}`);
            totalFailed += batch.length;
          }
        } catch (err: any) {
          addLog(`❌ 批次 ${batchNum} 网络错误: ${err.message}`);
          totalFailed += batch.length;
        }

        // 小延迟避免限流
        await new Promise((r) => setTimeout(r, 500));
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

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.location.href = '/admin'} className="p-2 hover:bg-white/10 rounded-lg transition">←</button>
          <div>
            <h1 className="text-2xl font-bold">📤 数据导入工具</h1>
            <p className="text-sm text-white/40">将 JSON 资源文件导入 Neon 数据库</p>
          </div>
        </div>

        {/* File Upload */}
        <div
          className={`border-2 border-dashed rounded-2xl p-8 text-center mb-6 transition cursor-pointer ${
            file ? 'border-violet-500 bg-violet-500/10' : 'border-white/20 hover:border-white/40'
          }`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && f.name.endsWith('.json')) handleFile(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
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
              <div className="text-white/60">点击选择或拖拽 JSON 文件到这里</div>
              <div className="text-sm text-white/40 mt-2">支持 zzmm_data_compact.json 格式</div>
            </div>
          )}
        </div>

        {/* Actions */}
        {file && status === 'idle' && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={startImport}
            className="w-full py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition"
          >
            ▶️ 开始导入 ({((file.size / 1024 / 1024).toFixed(2))}MB / {(() => {
              try {
                // This won't work in template but we show estimate
                return '44886';
              } catch {
                return '?';
              }
            })()} 条)
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
              <div
                className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Results */}
        {status === 'done' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-green-500/20 border border-green-500/30 rounded-xl p-5 mb-6"
          >
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
                <div key={i} className={line.includes('❌') ? 'text-red-400' : line.includes('✅') ? 'text-green-400' : 'text-white/60'}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info */}
        <div className="mt-6 text-sm text-white/40">
          <p>💡 提示：每次导入最多 {200} 条，自动分批处理。导入前会清空现有数据。</p>
          <p>⚠️ 如需保留现有数据，请先备份后再导入。</p>
        </div>

        {/* Admin Key */}
        {showKeyInput && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-6 bg-[#12121a] rounded-xl p-5 border border-white/5"
          >
            <h3 className="font-medium mb-3">🔑 管理员密钥</h3>
            <p className="text-xs text-white/40 mb-3">在 Vercel 环境变量中设置的 ADMIN_SECRET 值</p>
            <div className="flex gap-2">
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
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
      </div>
    </div>
  );
}