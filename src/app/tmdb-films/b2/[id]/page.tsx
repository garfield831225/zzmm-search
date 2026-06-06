'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lock, Copy, ExternalLink, Check } from 'lucide-react';

const SOURCE_META: Record<string, { label: string; icon: string }> = {
  '115': { label: '115网盘', icon: '💜' },
  'baidu': { label: '百度网盘', icon: '💙' },
  'aliyun': { label: '阿里云盘', icon: '💚' },
  'quark': { label: '夸克网盘', icon: '🩷' },
  '123': { label: '123网盘', icon: '🧡' },
  'tianyi': { label: '天翼云盘', icon: '🩵' },
  'magnet': { label: '磁力链接', icon: '🧲' },
  'ed2k': { label: 'ed2k链接', icon: '🔗' },
  'thunder': { label: '迅雷链接', icon: '⚡' },
};

export default function B2DetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [showVip, setShowVip] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/tmdb-films/b2/${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">加载中...</div>;
  if (!data?.resource) return <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center text-white/40">未找到</div>;

  const r = data.resource;
  const meta = SOURCE_META[r.source] || { label: r.source, icon: '📁' };
  const isMagnetLike = r.source === 'magnet' || r.source === 'ed2k' || r.source === 'thunder';

  const handleAction = () => {
    if (!r.canAccess) { setShowVip(true); return; }
    if (isMagnetLike) {
      navigator.clipboard.writeText(r.link || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      window.open(r.link, '_blank', 'noopener');
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Link href="/tmdb-films" className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-4">
          <ArrowLeft className="w-4 h-4" /> 返回 TMDB 影视
        </Link>
        <div className="bg-gradient-to-br from-amber-900/20 to-amber-700/10 border border-amber-500/30 rounded-2xl p-6">
          <div className="text-xs text-amber-300/80 mb-2">📝 您的导入·未匹配 TMDB</div>
          <h1 className="text-2xl md:text-3xl font-bold break-all">{r.name}</h1>
          <div className="flex flex-wrap items-center gap-3 mt-4 text-sm text-white/70">
            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs">{meta.icon} {meta.label}</span>
            {r.category && <span className="px-2 py-0.5 bg-white/5 rounded text-xs">{r.category}</span>}
            {r.size && <span className="px-2 py-0.5 bg-white/5 rounded text-xs">📦 {r.size}</span>}
            <span className={`px-2 py-0.5 rounded text-xs ${r.import_channel === 'zezhe' ? 'bg-green-500/20 text-green-300' : 'bg-amber-500/20 text-amber-300'}`}>
              {r.import_channel === 'zezhe' ? '🌿 泽泽妈妈' : '🟡 其他渠道'}
            </span>
          </div>
          {/* 链接详情 */}
          <div className="mt-5 space-y-2">
            {r.link_code && (
              <div className="flex items-center gap-2 p-3 bg-black/30 rounded-lg">
                <span className="text-xs text-white/40">🔑 提取码</span>
                <code className="text-amber-300 font-mono">{r.link_code}</code>
              </div>
            )}
            {r.link && (
              <div className="flex items-center gap-2 p-3 bg-black/30 rounded-lg">
                <span className="text-xs text-white/40 flex-shrink-0">🔗 链接</span>
                <code className="text-xs text-white/60 truncate flex-1">{r.link}</code>
              </div>
            )}
            {r.type && (
              <div className="flex items-center gap-2 p-3 bg-black/30 rounded-lg">
                <span className="text-xs text-white/40">📝 类型</span>
                <span className="text-sm">{r.type}</span>
              </div>
            )}
            {r.tags && r.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 p-3 bg-black/30 rounded-lg">
                <span className="text-xs text-white/40">🏷️ 标签</span>
                {r.tags.map((t: string) => <span key={t} className="px-2 py-0.5 bg-white/5 rounded text-xs">{t}</span>)}
              </div>
            )}
            <div className="flex items-center gap-2 p-3 bg-black/30 rounded-lg">
              <span className="text-xs text-white/40">👁 查看</span>
              <span className="text-sm">{r.view_count} 次</span>
            </div>
          </div>
          {/* 操作按钮 */}
          <button
            onClick={handleAction}
            className={`mt-5 w-full py-3 rounded-xl font-medium transition ${
              r.canAccess
                ? 'bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90'
                : 'bg-white/5 text-white/40 hover:bg-white/10'
            }`}
          >
            {r.canAccess ? (
              isMagnetLike ? (
                copied ? <><Check className="w-4 h-4 inline" /> 已复制</> : <><Copy className="w-4 h-4 inline" /> 复制链接</>
              ) : (
                <><ExternalLink className="w-4 h-4 inline" /> 打开链接</>
              )
            ) : (
              <><Lock className="w-4 h-4 inline" /> 已锁定（{r.lockReason === 'code' ? `需付费 ¥${r.code_price}` : '需 VIP'}）</>
            )}
          </button>
        </div>
      </div>
      {/* VIP 弹窗 */}
      {showVip && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowVip(false)}>
          <div className="bg-gradient-to-br from-violet-900/40 to-pink-900/40 border border-violet-500/30 rounded-2xl p-6 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
            <div className="text-5xl mb-3">🔒</div>
            <h3 className="text-lg font-semibold mb-2">需要 VIP 会员</h3>
            <p className="text-sm text-white/60 mb-5">此资源来自其他渠道（不是泽泽妈妈文档导入），需要购买 VIP 会员才能打开或复制</p>
            <div className="flex gap-2">
              <button onClick={() => setShowVip(false)} className="flex-1 py-2.5 bg-white/10 rounded-xl text-sm">关闭</button>
              <Link href="/shop" className="flex-1 py-2.5 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium">购买 VIP</Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
