'use client';
// 2026-07-23: NAS 端立即匹配页 - 后台跑, 不阻塞
// 启动后立刻返回, 可以关闭页面, 任务继续跑
// 通过 polling GET /api/admin/match-now 看日志
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface MatchStatus {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastLine: string | null;
  logSize: number;
  logTail: string[];
  scriptPath: string;
  logFile: string;
}

export default function MatchNowPage() {
  const [status, setStatus] = useState<MatchStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [batchSize, setBatchSize] = useState(500);
  const [autoStart, setAutoStart] = useState(false);
  const [showLog, setShowLog] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const getToken = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/match-now', {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        // 不在跑就停 polling
        if (!data.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else {
        // token 无效时停 polling
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }
    } catch {}
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, 2000);
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/match-now', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ batchSize }),
      });
      const data = await res.json();
      if (res.ok) {
        setStatus({
          running: true,
          pid: data.pid,
          startedAt: data.startedAt,
          lastLine: '启动中...',
          logSize: 0,
          logTail: [],
          scriptPath: data.logFile,
          logFile: data.logFile,
        });
        startPolling();
      } else if (res.status === 409) {
        // 已在跑
        startPolling();
        await fetchStatus();
      } else {
        alert('启动失败: ' + (data.error || '未知错误'));
      }
    } catch (e: any) {
      alert('启动失败: ' + e.message);
    }
    setLoading(false);
  };

  const handleStop = async () => {
    if (!confirm('确定要终止当前匹配任务吗? 已处理的记录会保留, 未处理的会留下次继续.')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/match-now', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) {
        await fetchStatus();
      } else {
        alert('停止失败: ' + (data.error || '未知错误'));
      }
    } catch (e: any) {
      alert('停止失败: ' + e.message);
    }
    setLoading(false);
  };

  // 解析日志行提取统计
  const stats = parseStats(status?.logTail || []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin" className="p-2 hover:bg-white/10 rounded-lg">←</Link>
          <h1 className="text-2xl font-bold">🔄 立即匹配 (后台)</h1>
          <Link href="/admin/match" className="ml-auto text-sm text-violet-300 hover:underline">
            传统匹配管理 →
          </Link>
        </div>

        {/* 状态卡片 */}
        <div className={`rounded-xl p-5 mb-4 border ${
          status?.running
            ? 'bg-emerald-900/30 border-emerald-500/40'
            : 'bg-white/5 border-white/10'
        }`}>
          <div className="flex items-center gap-3 mb-3">
            <div className={`w-3 h-3 rounded-full ${status?.running ? 'bg-emerald-400 animate-pulse' : 'bg-white/30'}`} />
            <div className="text-lg font-semibold">
              {status?.running ? '匹配任务进行中' : '空闲 - 可启动新任务'}
            </div>
            {status?.pid && (
              <span className="text-xs text-white/40 ml-auto">PID: {status.pid}</span>
            )}
          </div>

          {status?.startedAt && (
            <div className="text-xs text-white/50 mb-2">
              启动于: {new Date(status.startedAt).toLocaleString('zh-CN')}
            </div>
          )}

          {stats && (
            <div className="grid grid-cols-5 gap-2 mt-3">
              <Stat label="已处理" value={stats.processed} color="text-white" />
              <Stat label="匹配" value={stats.matched} color="text-emerald-300" />
              <Stat label="复用" value={stats.reused} color="text-cyan-300" />
              <Stat label="乱码" value={stats.garbled} color="text-amber-300" />
              <Stat label="未匹配" value={stats.nomatch} color="text-white/50" />
            </div>
          )}
        </div>

        {/* 操作区 */}
        <div className="bg-white/5 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <label className="text-sm text-white/60">每批处理:</label>
            <select
              value={batchSize}
              onChange={e => setBatchSize(parseInt(e.target.value))}
              disabled={status?.running}
              className="bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="200">200 (快)</option>
              <option value="500">500 (默认)</option>
              <option value="1000">1000 (大)</option>
              <option value="2000">2000 (超大)</option>
            </select>
            <span className="text-xs text-white/40">
              每批 ~30s 跑完, 一次跑完会继续拉下一批直到没数据
            </span>
          </div>

          <div className="flex gap-2">
            {!status?.running ? (
              <button
                onClick={handleStart}
                disabled={loading}
                className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                {loading ? '启动中...' : '🚀 启动后台匹配'}
              </button>
            ) : (
              <>
                <button
                  onClick={handleStop}
                  disabled={loading}
                  className="px-5 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm font-medium"
                >
                  🛑 停止
                </button>
                <button
                  onClick={fetchStatus}
                  className="px-5 py-2.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm"
                >
                  🔄 刷新
                </button>
              </>
            )}
          </div>
        </div>

        {/* 日志区 */}
        <div className="bg-black/40 rounded-xl border border-white/10">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10">
            <span className="text-sm font-medium">📋 实时日志</span>
            <span className="text-xs text-white/40">
              {status?.logSize ? `${(status.logSize / 1024).toFixed(1)} KB` : '0 KB'}
            </span>
            <button
              onClick={() => setShowLog(v => !v)}
              className="ml-auto text-xs text-white/60 hover:text-white"
            >
              {showLog ? '收起' : '展开'}
            </button>
          </div>
          {showLog && (
            <pre className="text-xs text-white/80 p-4 font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
              {status?.logTail?.length
                ? status.logTail.join('\n')
                : '暂无日志'}
            </pre>
          )}
        </div>

        {/* 帮助 */}
        <div className="mt-6 text-xs text-white/40 space-y-1">
          <div>💡 <b>使用场景</b>: 导完数据后, 点这个按钮立刻触发匹配, 然后关掉页面也可以 (任务在后台跑)</div>
          <div>💡 <b>查看进度</b>: 每 2 秒自动刷新日志, 看到 <code className="text-emerald-300">DONE:</code> 就是跑完了</div>
          <div>💡 <b>停止任务</b>: 点"停止"会发 SIGTERM, 已处理记录保留, 剩下的下次重跑</div>
          <div>💡 <b>NAS 端 cron</b>: 每天凌晨 2 点会自动跑一次 (在 NAS GUI cron 配)</div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number | null; color: string }) {
  return (
    <div className="bg-black/30 rounded-lg p-2 text-center">
      <div className="text-xs text-white/50">{label}</div>
      <div className={`text-lg font-semibold ${color}`}>
        {value === null ? '-' : value.toLocaleString()}
      </div>
    </div>
  );
}

function parseStats(logTail: string[]) {
  // 从日志最后一行匹配 "DONE: processed=N matched=M nomatch=X garbled=Y reused=Z"
  // 或 "chunk X-Y: matched=M nomatch=X garbled=Y reused=Z"
  let processed: number | null = null;
  let matched: number | null = null;
  let nomatch: number | null = null;
  let garbled: number | null = null;
  let reused: number | null = null;

  for (const line of logTail) {
    const m = line.match(/processed=(\d+)/);
    if (m) processed = parseInt(m[1]);
    const m2 = line.match(/matched=(\d+)/);
    if (m2) matched = parseInt(m2[1]);
    const m3 = line.match(/nomatch=(\d+)/);
    if (m3) nomatch = parseInt(m3[1]);
    const m4 = line.match(/garbled=(\d+)/);
    if (m4) garbled = parseInt(m4[1]);
    const m5 = line.match(/reused=(\d+)/);
    if (m5) reused = parseInt(m5[1]);
  }

  if (processed === null && matched === null) return null;
  return { processed, matched, nomatch, garbled, reused };
}
