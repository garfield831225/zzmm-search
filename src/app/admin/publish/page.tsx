'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface PublishLog {
  id: number;
  resource_id: number;
  channels: string;
  qq_ok: boolean;
  tg_ok: boolean;
  content: string;
  error: string;
  published_by: number;
  created_at: string;
}

export default function PublishPage() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [resourceId, setResourceId] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [resources, setResources] = useState<any[]>([]);
  const [channels, setChannels] = useState<string[]>(['tg']);
  const [content, setContent] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [logs, setLogs] = useState<PublishLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    const cookieToken = document.cookie.split('; ').find(r => r.startsWith('zzmm_token='))?.split('=')[1];
    const saved = localStorage.getItem('adminToken');
    if (cookieToken || saved) {
      setToken(cookieToken || saved || '');
      setAuthed(true);
    }
  }, []);

  useEffect(() => {
    if (authed) fetchLogs();
  }, [authed]);

  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const r = await fetch('/api/admin/publish', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      const j = await r.json();
      if (j.ok) setLogs(j.items || []);
    } finally {
      setLoadingLogs(false);
    }
  };

  const searchResources = async () => {
    if (!searchQ.trim()) return;
    const r = await fetch(`/api/search?q=${encodeURIComponent(searchQ)}&limit=10`);
    const j = await r.json();
    setResources(j.items || j.results || j.data || []);
  };

  const publish = async () => {
    if (!resourceId) {
      setResult({ ok: false, error: '请先选择资源' });
      return;
    }
    if (!channels.length) {
      setResult({ ok: false, error: '请选择至少一个渠道' });
      return;
    }
    setPublishing(true);
    setResult(null);
    try {
      const r = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resource_id: Number(resourceId),
          channels,
          content: content || undefined,
        }),
      });
      const j = await r.json();
      setResult(j);
      fetchLogs();
    } finally {
      setPublishing(false);
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-8">
        <div className="max-w-md w-full">
          <h1 className="text-2xl font-bold mb-4">管理员登录</h1>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="JWT token"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded"
          />
          <button
            onClick={() => { if (token) { localStorage.setItem('adminToken', token); setAuthed(true); } }}
            className="mt-3 w-full px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded"
          >登录</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">📢 对外发布</h1>
        <p className="text-zinc-400 mb-6">推资源到 QQ 群机器人 + TG 频道</p>

        <div className="bg-zinc-900 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">选择资源</h2>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchResources()}
              placeholder="搜索资源名..."
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded"
            />
            <button onClick={searchResources} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded">搜索</button>
          </div>
          {resources.length > 0 && (
            <div className="bg-zinc-800 rounded max-h-60 overflow-y-auto mb-3">
              {resources.map((r: any) => (
                <div
                  key={r.id}
                  onClick={() => setResourceId(String(r.id))}
                  className={`px-3 py-2 cursor-pointer hover:bg-zinc-700 ${resourceId === String(r.id) ? 'bg-indigo-900' : ''}`}
                >
                  <div className="font-medium">{r.name || r.title}</div>
                  <div className="text-xs text-zinc-400">id: {r.id} · {r.type || r.category}</div>
                </div>
              ))}
            </div>
          )}
          <div className="text-sm text-zinc-400">已选资源 ID: <span className="text-white font-mono">{resourceId || '无'}</span></div>
        </div>

        <div className="bg-zinc-900 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">选择渠道</h2>
          <div className="flex gap-4 mb-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={channels.includes('qq')}
                onChange={e => setChannels(e.target.checked ? [...channels, 'qq'] : channels.filter(c => c !== 'qq'))}
                className="w-4 h-4"
              />
              <span>QQ 群机器人 <span className="text-xs text-zinc-500">(v2.1.4 启用)</span></span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={channels.includes('tg')}
                onChange={e => setChannels(e.target.checked ? [...channels, 'tg'] : channels.filter(c => c !== 'tg'))}
                className="w-4 h-4"
              />
              <span>TG 频道 <span className="text-xs text-zinc-500">(需配 env)</span></span>
            </label>
          </div>
          <div className="text-sm text-zinc-400 mb-4">说明：选 0 渠道 = 不能发</div>

          <h2 className="text-xl font-semibold mb-4">自定义文案 (可选)</h2>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="留空用默认文案"
            rows={3}
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded mb-4"
          />

          <button
            onClick={publish}
            disabled={publishing || !resourceId}
            className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-700 disabled:cursor-not-allowed rounded font-semibold"
          >
            {publishing ? '发布中...' : '🚀 发布'}
          </button>

          {result && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 p-4 rounded ${result.ok ? 'bg-green-900/30 border border-green-700' : 'bg-red-900/30 border border-red-700'}`}
            >
              <div className="font-semibold mb-1">{result.ok ? '✓ 发布成功' : '✗ 发布失败'}</div>
              <div className="text-sm">{result.message || result.error}</div>
              {result.channels && (
                <div className="mt-2 text-xs">
                  {result.channels.map((c: any) => (
                    <div key={c.channel}>[{c.channel}] {c.ok ? '✓' : '✗'} {c.msg}</div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </div>

        <div className="bg-zinc-900 rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">发布历史</h2>
            <button onClick={fetchLogs} className="text-sm text-indigo-400 hover:text-indigo-300">刷新</button>
          </div>
          {loadingLogs ? <div className="text-zinc-400">加载中...</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-400 border-b border-zinc-800">
                    <th className="text-left py-2">id</th>
                    <th className="text-left py-2">资源</th>
                    <th className="text-left py-2">渠道</th>
                    <th className="text-left py-2">结果</th>
                    <th className="text-left py-2">错误</th>
                    <th className="text-left py-2">时间</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id} className="border-b border-zinc-800">
                      <td className="py-2">{l.id}</td>
                      <td className="py-2">{l.resource_id}</td>
                      <td className="py-2">{l.channels}</td>
                      <td className="py-2">
                        {l.qq_ok && <span className="text-green-400">QQ✓</span>}
                        {l.tg_ok && <span className="text-green-400 ml-1">TG✓</span>}
                        {!l.qq_ok && !l.tg_ok && <span className="text-red-400">全失败</span>}
                      </td>
                      <td className="py-2 text-xs text-zinc-500 max-w-xs truncate">{l.error || '-'}</td>
                      <td className="py-2 text-xs text-zinc-500">{new Date(l.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-zinc-500">暂无发布记录</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6 text-center">
          <a href="/admin" className="text-zinc-400 hover:text-white">← 返回后台首页</a>
        </div>
      </div>
    </div>
  );
}
