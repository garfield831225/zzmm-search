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

// 2026-07-26 改: CF tunnel 524 timeout = 100s, 587 条 1MB INSERT 50 并发要 126s
// 拆小到 ~300 条/批 (0.5MB) 让单批 < 90s, 给 CF 留 buffer
// Neon serverless 免费版 5 inserts/s 限速, 50 并发排队可能拖到 100s+
// 300 条 × 3 链接 = 900 INSERT × 50ms (含 Neon RPS 排队) ≈ 45-60s 应该 OK
const MAX_BATCH_BYTES = 500 * 1024;

export default function ImportTgPage() {
  const [file, setFile] = useState<File | null>(null);
  // 2026-07-24: 默认改成空, 让用户必须主动选, 防止又把所有数据标成 tg_baidu
  const [channelHint, setChannelHint] = useState('');
  // 2026-07-24: 加 mode tab - TG 入口也能上 Excel/CSV
  const [importMode, setImportMode] = useState<'json' | 'excel'>('json');
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

  // 2026-07-24: Excel/CSV 解析 (动态 import xlsx)
  // 把每行转成 message 格式: { id, type:'message', text: 'name\nlink code' }
  // 这样下游 extractLinksFromTgMessage / extractTitleFromTgMessage 不用改
  const handleExcelFile = async (f: File) => {
    setFile(f);
    setLog([]);
    setSplitPayloads([]);
    setBatchResults([]);
    addLog(`📁 已选择 Excel: ${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`);
    setParsing(true);
    setParseProgress(0);
    try {
      // 动态 import xlsx (避免初始包变大)
      addLog('📦 加载 xlsx 库...');
      setParseProgress(10);
      const XLSX = await import('xlsx');
      addLog('📖 读取文件...');
      const buf = await f.arrayBuffer();
      setParseProgress(30);
      const wb = XLSX.read(buf, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      setParseProgress(60);
      addLog(`✅ Sheet[${sheetName}] 共 ${rows.length} 行, 自动识别列...`);

      if (rows.length === 0) {
        addLog('❌ Excel 无数据');
        return;
      }

      // 智能识别列名
      const headers = Object.keys(rows[0]);
      const lower = headers.map(c => c.toLowerCase());
      const find = (...kws: string[]) => {
        for (const k of kws) {
          const i = lower.findIndex(c => c.includes(k));
          if (i >= 0) return headers[i];
        }
        return '';
      };
      const nameCol = find('名称', 'name', '标题', 'title', '片名') || headers[0];
      const linkCol = find('链接', 'link', 'url', '地址') || headers[1];
      const codeCol = find('提取码', 'code', '密码', 'password') || '';
      const catCol = find('分类', 'category', '类型') || '';

      addLog(`📋 列识别: 名称=${nameCol} 链接=${linkCol} 提取码=${codeCol || '(无)'} 分类=${catCol || '(无)'}`);

      // 转成 messages
      const messages: any[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = String(row[nameCol] || '').trim();
        const link = String(row[linkCol] || '').trim();
        if (!name || !link) continue;
        const code = codeCol ? String(row[codeCol] || '').trim() : '';
        // text 格式: name + \n + link + 空格 + code (extractLinksFromTgMessage 解析)
        const text = code ? `${name}\n${link} ${code}` : `${name}\n${link}`;
        messages.push({
          id: i + 1,
          type: 'message',
          text,
          date: new Date().toISOString(),
        });
        if (i % 5000 === 0) {
          setParseProgress(60 + Math.round((i / rows.length) * 30));
          await new Promise(r => setTimeout(r, 0));
        }
      }
      setParseProgress(90);
      addLog(`✅ 转换完成: ${messages.length} 条 message`);

      // 切批 (复用 JSON 切批逻辑)
      const baseOverhead = JSON.stringify({ messages: [], channelHint }).length + 5;
      const batches: { name: string; jsonStr: string; count: number; bytes: number }[] = [];
      let current: any[] = [];
      let currentBytes = baseOverhead;
      for (let i = 0; i < messages.length; i++) {
        const msgJson = JSON.stringify(messages[i]);
        const msgBytes = msgJson.length + 1;
        if (currentBytes + msgBytes > MAX_BATCH_BYTES && current.length > 0) {
          const jsonStr = JSON.stringify({ messages: current, channelHint });
          batches.push({ name: `批 ${batches.length + 1}`, jsonStr, count: current.length, bytes: currentBytes });
          current = [];
          currentBytes = baseOverhead;
        }
        current.push(messages[i]);
        currentBytes += msgBytes;
      }
      if (current.length > 0) {
        const jsonStr = JSON.stringify({ messages: current, channelHint });
        batches.push({ name: `批 ${batches.length + 1}`, jsonStr, count: current.length, bytes: currentBytes });
      }
      setParseProgress(100);
      addLog(`✂️ 切成 ${batches.length} 批, 共 ${messages.length} 条`);
      addLog(`💡 准备上传. 点击下方按钮开始.`);
      setSplitPayloads(batches);
    } catch (e: any) {
      addLog('❌ Excel 解析失败: ' + (e.message?.slice(0, 200) || String(e)));
    } finally {
      setParsing(false);
    }
  };

  // 包装 handleFile: 根据 mode 选 JSON 还是 Excel 解析
  const handleAnyFile = async (f: File) => {
    if (importMode === 'excel') {
      await handleExcelFile(f);
    } else {
      await handleFile(f);
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

      // 2026-08-12: 加 retry 2 次 + 间隔 5s (Neon RPS 限流会被 batch 1 撞到, batch 2/3/4 可能被拒, retry 容错)
      //   业务: 之前 116 批 28797 条, batch 1 90s + batch 2 46s 失败, 整个上传中断
      //   现在每个 batch 失败时 sleep 5s 重试, 最多 3 次
      const MAX_RETRIES = 3;
      let lastError: any = null;
      let success = false;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const start = Date.now();
          // 2026-07-26 改: 90s abort 早于 CF tunnel 524 timeout (100s)
          // route.ts maxDuration=300, 但 CF 等 100s 就断开 → 524 HTML 错误
          // 90s abort 让 client 主动断, 返 AbortError, 提示用户重试更小批
          // 2026-08-12 改: 150s abort (Neon RPS 限流 + 288 条 2 并发实际 70-90s, 150s 给 buffer)
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 150_000);
          let r: Response;
          try {
            r = await fetch('/api/admin/import/tg-json', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + token,
              },
              body: JSON.stringify({ jsonContent: batch.jsonStr }),
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
          const data = await r.json();
          const duration = Date.now() - start;

          if (data.error) {
            // server 端返 error 也算失败, retry
            lastError = new Error(data.error);
            throw lastError;
          }

          const s = data.summary || {};
          const l1 = s.l1 || {};
          const l2 = s.l2 || {};
          addLog(`✅ [${i + 1}] L1入库 ${l1.inserted}/${l1.candidates}, L2入库 ${l2.inserted}/${l2.candidates} (队列+${l2.queue_added || 0}) ${duration}ms${attempt > 1 ? ` (第 ${attempt} 次成功)` : ''}`);
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
          success = true;
          break;
        } catch (e: any) {
          lastError = e;
          if (attempt < MAX_RETRIES) {
            const errMsg = e.name === 'AbortError' ? '超时' : (e.message?.slice(0, 100) || '未知错误');
            addLog(`⚠️ [${i + 1}] 第 ${attempt} 次失败 (${errMsg}), 5s 后重试...`);
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      }

      if (!success && lastError) {
        const e = lastError;
        if (e.name === 'AbortError') {
          addLog(`⏱️ [${i + 1}] 超时 (3 次重试都失败, >150s), 批次 ${batch.count} 条太多被 Neon 卡住. 建议: 重新切更小批次 (200 条) 重试.`);
        } else if (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError')) {
          addLog(`❌ [${i + 1}] 网络断开 (3 次重试都失败). 检查: 1) 浏览器没关 2) 域名 zzmm-search.uk 通 3) NAS systemd 在跑`);
        } else {
          addLog(`❌ [${i + 1}] 失败 (3 次重试): ${e.message?.slice(0, 200)}`);
        }
        allResults.push({
          batch: i + 1,
          total_messages: batch.count,
          l1_candidates: 0, l1_inserted: 0, l1_skipped: 0, l1_failed: 0,
          l2_candidates: 0, l2_inserted: 0, l2_queue_added: 0, l2_skipped: 0, l2_failed: 0,
          by_category: {}, by_source: {}, duration_ms: 0, file_size_mb: 0,
          errors: [e.message?.slice(0, 200) || 'failed after 3 retries'],
        });
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

        {/* 导入模式 tab: JSON / Excel/CSV */}
        <div className="mb-4 flex gap-2 bg-white/5 p-1 rounded-xl">
          <button
            onClick={() => { if (!uploading) { setImportMode('json'); resetAll(); } }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              importMode === 'json' ? 'bg-cyan-600 text-white' : 'text-white/60 hover:bg-white/5'
            }`}
          >
            📡 TG JSON (result.json)
          </button>
          <button
            onClick={() => { if (!uploading) { setImportMode('excel'); resetAll(); } }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${
              importMode === 'excel' ? 'bg-amber-600 text-white' : 'text-white/60 hover:bg-white/5'
            }`}
          >
            📊 Excel / CSV
          </button>
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
            if (f) handleAnyFile(f);
          }}
        >
          <input
            ref={fileRef}
            type="file"
            accept={importMode === 'json' ? '.json,application/json' : '.xlsx,.xls,.csv'}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleAnyFile(f); }}
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
              <div className="text-white/60">
                点击选择或拖拽 {importMode === 'json' ? 'result.json' : 'Excel/CSV 文件'}
              </div>
              <div className="text-sm text-white/40 mt-2">
                {importMode === 'json'
                  ? '支持任意大小, 自动按 3.5MB/批 切片'
                  : '支持 .xlsx .xls .csv, 自动识别名称/链接/提取码列'}
              </div>
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
