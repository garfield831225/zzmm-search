'use client';
// 2026-07-26: NAS 端立即同步 vip 页面 (跟 match-now 同样模式)
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

interface VipSyncStatus {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  lastLine: string | null;
  logSize: number;
  logTail: string[];
  scriptPath: string;
  logFile: string;
  stats: { totalSuccess: number; totalFail: number; lastPage: number; done: boolean } | null;
}

export default function VipSyncPage() {
  const [status, setStatus] = useState<VipSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pagesPerTask, setPagesPerTask] = useState(5);
  const [showLog, setShowLog] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const getToken = () => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('zzmm_token') || localStorage.getItem('token') || localStorage.getItem('adminToken') || '';
  };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/vip-sync', {
        headers: { Authorization: `Bearer ${getToken()}` },
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (!data.running && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } else {
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
      const res = await fetch('/api/admin/vip-sync', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pagesPerTask }),
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
          stats: null,
        });
        startPolling();
      } else if (res.status === 409) {
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
    if (!confirm('确定要终止当前 VIP 同步任务吗? 已处理的记录保留, 剩下的下次重跑.')) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/vip-sync', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (res.ok) await fetchStatus();
      else alert('停止失败: ' + (data.error || '未知错误'));
    } catch (e: any) {
      alert('停止失败: ' + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin" className="p-2 hover:bg-white/10 rounded-lg">←</Link>
          <h1 className="text-2xl font-bold">🎬 VIP 影视同步 (后台)</h1>
          <Link href="/vip" className="ml-auto text-sm text-violet-300 hover:underline">
            VIP 影视区 →
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
              {status?.running ? 'VIP 同步任务进行中' : '空闲 - 可启动新任务'}
            </div>
            {status?.pid && (
              <span className="text-xs text-white/40 ml-auto">PID: {status.pid}</span>
            )}
          </div>

          {status?.startedAt && (
            <div className="text-xs text-white/50 mb-2">
              启动于: {status.startedAt}
            </div>
          )}

          {status?.stats && (
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-xs text-white/50">已同步</div>
                <div className="text-lg font-semibold text-emerald-300">{status.stats.totalSuccess.toLocaleString()}</div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-xs text-white/50">失败</div>
                <div className="text-lg font-semibold text-amber-300">{status.stats.totalFail.toLocaleString()}</div>
              </div>
              <div className="bg-black/30 rounded-lg p-2 text-center">
                <div className="text-xs text-white/50">状态</div>
                <div className="text-lg font-semibold text-white/80">
                  {status.stats.done ? '✅ 完成' : (status.running ? '🔄 进行中' : '—')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 操作区 */}
        <div className="bg-white/5 rounded-xl p-5 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <label className="text-sm text-white/60">每任务页数:</label>
            <select
              value={pagesPerTask}
              onChange={e => setPagesPerTask(parseInt(e.target.value))}
              disabled={status?.running}
              className="bg-white/10 border border-white/20 rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="2">2 (小, 40 条)</option>
              <option value="5">5 (默认, 100 条/任务)</option>
              <option value="10">10 (中, 200 条/任务)</option>
              <option value="20">20 (大, 400 条/任务)</option>
              <option value="50">50 (超大, 1000 条/任务)</option>
            </select>
            <span className="text-xs text-white/40">
              4 个任务 (popular movie/tv + top_rated movie/tv) × 每任务页数 × 20
            </span>
          </div>

          <div className="flex gap-2">
            {!status?.running ? (
              <button
                onClick={handleStart}
                disabled={loading}
                className="px-5 py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 disabled:opacity-50 rounded-lg text-sm font-medium"
              >
                {loading ? '启动中...' : '🚀 立即同步 VIP 影视'}
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
          <div>💡 <b>使用场景</b>: 想立刻拉新热门电影/剧集, 点这个按钮触发, 然后关掉页面也继续跑</div>
          <div>💡 <b>每日自动</b>: NAS systemd timer 每天 02:00 自动跑 (5 页/任务 = 320 条/天)</div>
          <div>💡 <b>查看进度</b>: 每 2 秒自动刷新日志, 看到 <code className="text-emerald-300">DONE:</code> 或 <code className="text-emerald-300">sync done</code> 就是跑完</div>
          <div>💡 <b>停止任务</b>: 点"停止"会发 SIGTERM, 已处理记录保留, 剩下的下次重跑</div>
          <div>💡 <b>upsert 模式</b>: 重复跑会更新 popularity + 评分, 不会重复插入</div>
        </div>
      </div>
    </div>
  );
}
