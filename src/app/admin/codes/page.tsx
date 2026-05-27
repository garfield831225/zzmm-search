'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';

export default function CodesPage() {
  const [codes, setCodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [key, setKey] = useState('');

  const fetchCodes = async () => {
    if (!key) return;
    setLoading(true);
    try {
      const res = await fetch('/api/admin/codes?key=' + key);
      const data = await res.json();
      setCodes(data.items || []);
    } catch {} finally { setLoading(false); }
  };

  const unusedCodes = codes.filter(c => c.status === 'unused');

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">🎫 可用卡密（管理员）</h1>

        <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5 mb-6">
          <label className="block text-sm text-white/60 mb-2">管理员密钥</label>
          <div className="flex gap-3">
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="输入 JWT_SECRET"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50"
            />
            <button
              onClick={fetchCodes}
              disabled={loading}
              className="px-6 py-3 bg-violet-600 rounded-xl hover:opacity-90 disabled:opacity-50"
            >
              {loading ? '加载中...' : '查看卡密'}
            </button>
          </div>
        </div>

        {unusedCodes.length > 0 && (
          <div className="bg-[#12121a] rounded-2xl p-6 border border-white/5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">可用卡密（共 {unusedCodes.length} 个）</h2>
              <button
                onClick={() => {
                  const text = unusedCodes.map(c => `${c.code} (${c.days}天)`).join('\n');
                  navigator.clipboard.writeText(text).then(() => alert('已复制到剪贴板！'));
                }}
                className="px-4 py-2 bg-violet-600/30 rounded-lg text-sm hover:bg-violet-600/50"
              >
                一键复制全部
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {unusedCodes.map((c: any) => (
                <div key={c.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl hover:bg-white/10 transition cursor-pointer"
                  onClick={() => { navigator.clipboard.writeText(c.code); alert(`已复制: ${c.code}`); }}>
                  <div>
                    <div className="font-mono text-violet-300 text-lg tracking-wider">{c.code}</div>
                    <div className="text-xs text-white/40 mt-1">{c.batch_id} · {c.days}天</div>
                  </div>
                  <div className="px-3 py-1 bg-green-600/30 text-green-400 rounded-lg text-sm">
                    可用
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {codes.length > 0 && unusedCodes.length === 0 && (
          <div className="text-center py-12 text-white/40">
            暂无可用卡密
          </div>
        )}
      </div>
    </div>
  );
}