'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';

interface BatchResult {
  batch: number;
  total_messages: number;
  l1_candidates: number;
  l1_inserted: number;
  l1_skipped: number;
  l1_failed: number;
  l2_candidates: number;
  l2_inserted: number;
  l2_queue_added: number;
  l2_skipped: number;
  l2_failed: number;
  by_category: Record<string, number>;
  by_source: Record<string, number>;
  errors?: string[];
  duration_ms: number;
  file_size_mb: number;
}

interface L3Status {
  total: number;
  by_status: Record<string, number>;
  recent: Array<{
    id: number;
    telegra_ph_url: string;
    status: string;
    attempts: number;
    last_error?: string;
    created_at: string;
    processed_at?: string;
  }>;
}

const CHANNEL_OPTIONS = [
  { value: 'tg_baidu', label: 'TG 百度网盘', icon: '🅱️' },
  { value: 'tg_quark', label: 'TG 夸克网盘', icon: '🍊' },
  { value: 'tg_aliyun', label: 'TG 阿里云盘', icon: '☁️' },
  { value: 'tg_xunlei', label: 'TG 迅雷网盘', icon: '⚡' },
  { value: 'tg_123', label: 'TG 123网盘', icon: '🔢' },
  { value: 'tg_uc', label: 'TG UC网盘', icon: '🐻' },
  { value: 'tg_tianyi', label: 'TG 天翼云盘', icon: '☁️' },
  { value: 'tg_yidong', label: 'TG 移动云盘', icon: '📱' },
  { value: 'tg_music', label: 'TG 音乐', icon: '🎵' },
  { value: 'tg_other', label: 'TG 其他', icon: '📦' },
];

// Vercel Hobby body 限制 4.5MB, JSON 转义 + headers 余量, 实际安全上限 ~2MB
// 但每条消息 1 资源 + N 链接 = N+1 INSERT, Vercel 60s 超时
// 1 消息 200 字节平均 + 2 链接 = 400 字节. 2MB ≈ 5000 消息 ≈ 15000 INSERT × 20ms = 300s 超时
// 1MB 保守切, 估算 800 消息 × 2 链接 = 2400 INSERT × 20ms = 48s 边界
// 800 消息 × 2 链接 = 1600 INSERT × 50 并发 = 32s 应该 OK
const MAX_BATCH_BYTES = 1 * 1024 * 1024;

export default function ImportTgPage() {
  const [file, setFile] = useState<File | null>(null);
  const [channelHint, setChannelHint] = useState('tg_baidu');
  const [parsing, setParsing] = useState(false);
  const [parseProgress, setParseProgress] = useState(0);  // 0-100, 解析中显示
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [l3Status, setL3Status] = useState<L3Status | null>(null);
  const [l3Processing, setL3Processing] = useState(false);
  // 切好的批次 — JSON 字符串直接存, 不存 messages 数组 (省内存)
  const [splitPayloads, setSplitPayloads] = useState<{ name: string; jsonStr: string; count: number; bytes: number }[]>([]);
  // 上传中停止信号 (用 ref 避免闭包旧值)
  const stopUploadRef = useRef(false);

  const fileRef = useRef<HTMLInputElement>(null);

  // 重置 (放错文件 / 改频道类型时清空)
  const resetAll = useCallback(() => {
    if (uploading) {
      if (!confirm('正在上传中, 确定要放弃当前上传并重置吗? 已上传的批次不会回滚')) return;
      stopUploadRef.current = true;
    } else if (splitPayloads.length > 0) {
      if (!confirm(`已切成 ${splitPayloads.length} 批, 确定清空并重选吗?`)) return;
    }
    setFile(null);
    setSplitPayloads([]);
    setBatchResults([]);
    setProgress(0);
    setParseProgress(0);
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] 🔄 已重置`]);
    if (fileRef.current) fileRef.current.value = '';
  }, [uploading, splitPayloads.length]);

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const getToken = () => {
    return localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
  };

  // 按字节切 messages, 每批 JSON 字符串 < MAX_BATCH_BYTES
  const handleFile = async (f: File) => {
    setFile(f);
    setLog([]);
    setSplitPayloads([]);
    setBatchResults([]);
    addLog(`📁 已选择: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);

    if (f.size > 300 * 1024 * 1024) {
      addLog(`❌ 文件超过 300MB, 浏览器解析可能崩溃. 建议先本地拆分`);
      return;
    }

    setParsing(true);
    setParseProgress(0);
    addLog('📖 解析 JSON (大文件可能需 10-30 秒)...');
    try {
      // 给浏览器一个呼吸时间
      await new Promise(r => setTimeout(r, 50));
      const text = await f.text();
      setParseProgress(50);
      addLog('✅ 文件读取完成, 解析 JSON...');
      await new Promise(r => setTimeout(r, 50));

      const data = JSON.parse(text);
      const messages = data.messages || [];
      if (!Array.isArray(messages)) {
        addLog('❌ JSON 格式错误: 没有 messages 数组');
        setParsing(false);
        return;
      }
      setParseProgress(70);
      addLog(`✅ 共 ${messages.length} 条消息, 切批中...`);
      await new Promise(r => setTimeout(r, 50));

      // 按字节切 — 每批 JSON 字符串 < MAX_BATCH_BYTES
      const baseOverhead = JSON.stringify({ messages: [], channelHint }).length + 5;  // 头部 + 尾部
      const batches: { name: string; jsonStr: string; count: number; bytes: number }[] = [];
      let current: any[] = [];
      let currentBytes = baseOverhead;

      for (let i = 0; i < messages.length; i++) {
        const msgJson = JSON.stringify(messages[i]);
        const msgBytes = msgJson.length + 1;  // +1 逗号

        if (currentBytes + msgBytes > MAX_BATCH_BYTES && current.length > 0) {
          const jsonStr = JSON.stringify({ messages: current, channelHint });
          batches.push({
            name: `批 ${batches.length + 1} (${batches.reduce((a, b) => a + b.count, 0) + 1}-${batches.reduce((a, b) => a + b.count, 0) + current.length})`,
            jsonStr,
            count: current.length,
            bytes: jsonStr.length,
          });
          current = [];
          currentBytes = baseOverhead;
        }
        current.push(messages[i]);
        currentBytes += msgBytes;

        if (i % 10000 === 0) {
          setParseProgress(70 + Math.round((i / messages.length) * 25));
          await new Promise(r => setTimeout(r, 0));  // 让 UI 刷新
        }
      }
      if (current.length > 0) {
        const jsonStr = JSON.stringify({ messages: current, channelHint });
        batches.push({
          name: `批 ${batches.length + 1} (${batches.reduce((a, b) => a + b.count, 0) + 1}-${batches.reduce((a, b) => a + b.count, 0) + current.length})`,
          jsonStr,
          count: current.length,
          bytes: jsonStr.length,
        });
      }

      setParseProgress(100);
      const totalBytes = batches.reduce((a, b) => a + b.bytes, 0);
      addLog(`✂️ 切成 ${batches.length} 批, 总计 ${(totalBytes / 1024 / 1024).toFixed(1)}MB, 每批 ${(batches[0]?.bytes / 1024 / 1024).toFixed(2)}MB 左右`);
      addLog(`💡 准备上传. 点击下方按钮开始.`);
      setSplitPayloads(batches);
    } catch (e: any) {
      addLog('❌ JSON 解析失败: ' + (e.message?.slice(0, 200) || String(e)));
    } finally {
      setParsing(false);
    }
  };

  const startUpload = async () => {
    if (splitPayloads.length === 0) {
      addLog('❌ 没有可上传的批次 (先选文件)');
      return;
    }

    if (!confirm(`开始上传 ${splitPayloads.length} 批? 每批约 ${(splitPayloads[0].bytes / 1024 / 1024).toFixed(2)}MB, 预计耗时 ${splitPayloads.length * 5} 秒`)) return;

    setUploading(true);
    setProgress(0);
    setBatchResults([]);
    stopUploadRef.current = false;
    addLog(`🚀 开始上传 ${splitPayloads.length} 个批次...`);

    const token = getToken();
    const allResults: BatchResult[] = [];

    for (let i = 0; i < splitPayloads.length; i++) {
      if (stopUploadRef.current) {
        addLog(`🛑 收到停止信号, 中断 (已传 ${i}/${splitPayloads.length} 批)`);
        break;
      }
      const batch = splitPayloads[i];
      addLog(`📤 [${i + 1}/${splitPayloads.length}] ${batch.name} (${batch.count} 条, ${(batch.bytes / 1024 / 1024).toFixed(2)}MB)`);

      try {
        const start = Date.now();
        const r = await fetch('/api/admin/import/tg-json', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({ jsonContent: batch.jsonStr }),
        });
        const data = await r.json();
        const duration = Date.now() - start;

        if (data.error) {
          addLog(`❌ [${i + 1}] ${data.error}`);
          allResults.push({
            batch: i + 1,
            total_messages: batch.count,
            l1_candidates: 0, l1_inserted: 0, l1_skipped: 0, l1_failed: 0,
            l2_candidates: 0, l2_inserted: 0, l2_queue_added: 0, l2_skipped: 0, l2_failed: 0,
            by_category: {}, by_source: {}, duration_ms: duration, file_size_mb: 0,
            errors: [data.error],
          });
        } else {
          const s = data.summary || {};
          const l1 = s.l1 || {};
          const l2 = s.l2 || {};
          addLog(`✅ [${i + 1}] L1入库 ${l1.inserted}/${l1.candidates}, L2入库 ${l2.inserted}/${l2.candidates} (队列+${l2.queue_added || 0}) ${duration}ms`);
          if (data.by_category) {
            const top5 = Object.entries(data.by_category).slice(0, 5).map(([k, v]) => `${k}:${v}`).join(', ');
            addLog(`   📊 分类: ${top5}`);
          }
          if (data.by_source) {
            const src = Object.entries(data.by_source).map(([k, v]) => `${k}:${v}`).join(', ');
            addLog(`   📊 来源: ${src}`);
          }
          allResults.push({
            batch: i + 1,
            total_messages: s.total_messages || 0,
            l1_candidates: l1.candidates || 0,
            l1_inserted: l1.inserted || 0,
            l1_skipped: l1.skipped || 0,
            l1_failed: l1.failed || 0,
            l2_candidates: l2.candidates || 0,
            l2_inserted: l2.inserted || 0,
            l2_queue_added: l2.queue_added || 0,
            l2_skipped: l2.skipped || 0,
            l2_failed: l2.failed || 0,
            by_category: data.by_category || {},
            by_source: data.by_source || {},
            duration_ms: duration,
            file_size_mb: 0,
            errors: data.errors,
          });
        }
      } catch (e: any) {
        addLog(`❌ [${i + 1}] 网络错误: ${e.message}`);
      }

      setProgress(Math.round(((i + 1) / splitPayloads.length) * 100));
    }

    setBatchResults(allResults);
    setUploading(false);
    addLog(`\n🎉 全部完成! 共 ${allResults.length} 批次`);
    const totalL1 = allResults.reduce((a, r) => a + r.l1_inserted, 0);
    const totalL2 = allResults.reduce((a, r) => a + r.l2_inserted, 0);
    const totalQ = allResults.reduce((a, r) => a + r.l2_queue_added, 0);
    addLog(`📊 L1 入库: ${totalL1}, L2 入库: ${totalL2}, L3 队列新增: ${totalQ}`);

    // 刷新 L3 状态
    setTimeout(() => fetchL3Status(), 2000);
  };

  const fetchL3Status = async () => {
    try {
      const r = await fetch('/api/admin/import/tg-l3-worker?limit=10', {
        headers: { Authorization: 'Bearer ' + getToken() },
      });
      const data = await r.json();
      if (data.error) {
        addLog('❌ L3 状态查询失败: ' + data.error);
        return;
      }
      setL3Status(data);
    } catch (e: any) {
      addLog('❌ L3 状态查询错误: ' + e.message);
    }
  };

  const triggerL3Process = async (batchSize: number) => {
    if (!confirm(`开始抓 L3 (一次最多 ${batchSize} 条 telegra.ph, 每条 1 秒间隔, 预计 ${batchSize} 秒)?`)) return;
    setL3Processing(true);
    addLog(`🚀 触发 L3 抓取 (batchSize=${batchSize})...`);
    try {
      const r = await fetch('/api/admin/import/tg-l3-worker', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + getToken(),
        },
        body: JSON.stringify({ batchSize }),
      });
      const data = await r.json();
      if (data.error) {
        addLog('❌ L3 处理失败: ' + data.error);
      } else {
        addLog(`✅ L3 处理完成: 成功 ${data.succeeded}, 失败 ${data.failed}, 无链 ${data.no_links}`);
        if (data.errors?.length) addLog(`   错误样例: ${data.errors.slice(0, 3).join('; ')}`);
      }
    } catch (e: any) {
      addLog('❌ 网络错误: ' + e.message);
    } finally {
      setL3Processing(false);
      setTimeout(() => fetchL3Status(), 1000);
    }
  };

  useEffect(() => {
    fetchL3Status();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalL1 = batchResults.reduce((a, r) => a + r.l1_inserted, 0);
  const totalL2 = batchResults.reduce((a, r) => a + r.l2_inserted, 0);
  const totalQ = batchResults.reduce((a, r) => a + r.l2_queue_added, 0);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <button onClick={() => window.location.href = '/admin'} className="p-2 hover:bg-white/10 rounded-lg transition">←</button>
          <div>
            <h1 className="text-2xl font-bold">📥 TG 频道导入</h1>
            <p className="text-sm text-white/40">直接解析 Telegram Desktop result.json · VIP/admin 专属 · 业务规则: VIP 锁</p>
          </div>
        </div>

        {/* 业务规则说明 */}
        <div className="mb-6 bg-violet-500/10 border border-violet-500/30 rounded-xl p-4 text-sm">
          <div className="font-medium text-violet-200 mb-2">📋 业务规则</div>
          <ul className="space-y-1 text-white/70 text-xs">
            <li>• 所有 TG 导入资源自动设置 <code className="text-amber-300">access_level=vip, pay_type=vip</code></li>
            <li>• <b>basic 用户</b>: 看到 VIP 锁, 不能直接打开</li>
            <li>• <b>VIP 用户</b>: 直接打开</li>
            <li>• 直链(L1)立即入库; telegra.ph 中间页(L2)同时入 xx_resources + xx_telegram_l3_queue</li>
            <li>• L3 抓取走后台 worker (1秒/条 防 telegra.ph 限流, 一次最多 100 条)</li>
          </ul>
        </div>

        {/* Channel 选择 */}
        <div className="mb-6 bg-[#12121a] rounded-xl border border-white/5 p-4">
          <div className="text-sm font-medium mb-3">📡 频道类型</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {CHANNEL_OPTIONS.map(c => (
              <button
                key={c.value}
                onClick={() => setChannelHint(c.value)}
                className={`p-3 rounded-lg border transition text-left ${
                  channelHint === c.value
                    ? 'border-violet-500 bg-violet-500/20 text-white'
                    : 'border-white/10 bg-white/5 text-white/60 hover:border-white/30'
                }`}
              >
                <div className="text-xl mb-1">{c.icon}</div>
                <div className="text-xs font-medium">{c.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* File Upload */}
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
            accept=".json,application/json"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
          {file ? (
            <div>
              <div className="text-4xl mb-2">📄</div>
              <div className="font-medium">{file.name}</div>
              <div className="text-sm text-white/40 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</div>
              {splitPayloads.length > 0 && (
                <div className="mt-3 text-violet-300 text-sm">✂️ 已切成 {splitPayloads.length} 批 (每批 ≤ 1MB, 避开 60s 超时)</div>
              )}
              <div className="mt-3 flex gap-2 justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                  className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg"
                >
                  🔄 重新选文件
                </button>
                {splitPayloads.length > 0 && !uploading && (
                  <button
                    onClick={(e) => { e.stopPropagation(); resetAll(); }}
                    className="px-3 py-1.5 text-xs bg-red-500/10 hover:bg-red-500/20 text-red-300 rounded-lg"
                  >
                    ❌ 清空切批
                  </button>
                )}
              </div>
              <div className="mt-2 text-white/40 text-xs">点击空白处或拖拽可替换</div>
            </div>
          ) : (
            <div>
              <div className="text-4xl mb-2">📤</div>
              <div className="text-white/60">点击选择或拖拽 result.json</div>
              <div className="text-sm text-white/40 mt-2">支持任意大小, 自动按 3.5MB/批 切片</div>
            </div>
          )}
        </div>

        {/* 解析进度 */}
        {parsing && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span>⏳ 解析中 (大文件可能需 10-30 秒)...</span>
              <span>{parseProgress}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${parseProgress}%` }} />
            </div>
          </div>
        )}

        {splitPayloads.length > 0 && !uploading && (
          <div className="flex gap-2 mb-6">
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={startUpload}
              className="flex-1 py-4 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-medium text-lg hover:opacity-90 transition"
            >
              ▶️ 上传 {splitPayloads.length} 个批次 ({splitPayloads.reduce((a, b) => a + b.count, 0).toLocaleString()} 条消息, {splitPayloads.length * 5}-{splitPayloads.length * 15} 秒)
            </motion.button>
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={resetAll}
              className="px-6 py-4 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded-xl font-medium transition"
            >
              ❌ 清空
            </motion.button>
          </div>
        )}

        {uploading && (
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span>上传中...</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div className="bg-gradient-to-r from-violet-500 to-pink-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-3 flex justify-end">
              <button
                onClick={() => {
                  if (!confirm(`确定停止上传? 已传完的批次不会回滚, 剩余 ${splitPayloads.length - Math.floor(progress * splitPayloads.length / 100)} 批不会传`)) return;
                  stopUploadRef.current = true;
                  addLog('🛑 收到停止信号, 当前批次完成后中断...');
                }}
                className="px-4 py-2 text-sm bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded-lg"
              >
                🛑 停止上传
              </button>
            </div>
          </div>
        )}

        {/* 批次结果 */}
        {batchResults.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-6 bg-green-500/10 border border-green-500/30 rounded-xl p-5"
          >
            <div className="text-green-400 font-bold mb-3">✅ 导入完成</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">L1 直链入库</div>
                <div className="text-xl font-bold text-violet-300">{totalL1}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">L2 telegra.ph 入库</div>
                <div className="text-xl font-bold text-cyan-300">{totalL2}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">L3 队列新增</div>
                <div className="text-xl font-bold text-amber-300">{totalQ}</div>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="text-white/40 text-xs">总批次</div>
                <div className="text-xl font-bold text-white">{batchResults.length}</div>
              </div>
            </div>
          </motion.div>
        )}

        {/* L3 状态 + 触发 */}
        <div className="mb-6 bg-[#12121a] rounded-xl border border-white/5 p-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-medium">🔗 L3 (telegra.ph) 抓取队列</h3>
            <div className="flex gap-2">
              <button
                onClick={() => fetchL3Status()}
                className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 rounded-lg"
              >
                🔄 刷新
              </button>
              <button
                onClick={() => triggerL3Process(50)}
                disabled={l3Processing}
                className="px-3 py-1.5 text-xs bg-gradient-to-r from-amber-600 to-orange-600 hover:opacity-90 disabled:opacity-50 rounded-lg font-medium"
              >
                {l3Processing ? '抓取中...' : '⚡ 抓 50 条'}
              </button>
              <button
                onClick={() => triggerL3Process(20)}
                disabled={l3Processing}
                className="px-3 py-1.5 text-xs bg-gradient-to-r from-amber-700 to-orange-700 hover:opacity-90 disabled:opacity-50 rounded-lg font-medium"
              >
                {l3Processing ? '...' : '⚡ 抓 20 条'}
              </button>
            </div>
          </div>

          {l3Status ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-sm">
                <div className="bg-white/5 rounded-lg p-2">
                  <div className="text-white/40 text-xs">总数</div>
                  <div className="text-lg font-bold">{l3Status.total}</div>
                </div>
                <div className="bg-amber-500/10 rounded-lg p-2">
                  <div className="text-amber-300/70 text-xs">pending</div>
                  <div className="text-lg font-bold text-amber-300">{l3Status.by_status.pending || 0}</div>
                </div>
                <div className="bg-green-500/10 rounded-lg p-2">
                  <div className="text-green-300/70 text-xs">done</div>
                  <div className="text-lg font-bold text-green-300">{l3Status.by_status.done || 0}</div>
                </div>
                <div className="bg-red-500/10 rounded-lg p-2">
                  <div className="text-red-300/70 text-xs">failed</div>
                  <div className="text-lg font-bold text-red-300">{l3Status.by_status.failed || 0}</div>
                </div>
              </div>

              {l3Status.recent?.length > 0 && (
                <div>
                  <div className="text-xs text-white/40 mb-2">最近 10 条</div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {l3Status.recent.map(r => (
                      <div key={r.id} className="flex items-center gap-2 text-xs bg-white/5 rounded px-2 py-1">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                          r.status === 'done' ? 'bg-green-500/20 text-green-300' :
                          r.status === 'failed' ? 'bg-red-500/20 text-red-300' :
                          r.status === 'processing' ? 'bg-blue-500/20 text-blue-300' :
                          'bg-amber-500/20 text-amber-300'
                        }`}>
                          {r.status}
                        </span>
                        <span className="text-white/40 font-mono">#{r.id}</span>
                        <a href={r.telegra_ph_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate flex-1">
                          {r.telegra_ph_url}
                        </a>
                        <span className="text-white/40">attempts:{r.attempts}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-white/40 text-sm">加载中...</div>
          )}
        </div>

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-[#12121a] rounded-xl border border-white/5 p-4">
            <div className="text-sm font-medium mb-3 text-white/60">📋 执行日志</div>
            <div className="font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
              {log.map((line, i) => (
                <div key={i} className={line.includes('❌') ? 'text-red-400' : line.includes('✅') ? 'text-green-400' : line.includes('🎉') || line.includes('📊') ? 'text-amber-300' : 'text-white/60'}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
