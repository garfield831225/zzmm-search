'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, AlertCircle, Loader2, Sparkles, Crown, Calendar, Tag, ArrowRight, Home } from 'lucide-react';

interface ActivateResult {
  success: boolean;
  code_type?: 'vip' | 'unlock' | 'basic';
  plan_id?: string;
  plan_label?: string;
  duration_days?: number;
  channel?: string;
  channel_label?: string;
  batch_id?: string;
  old_expire_at?: string | null;
  new_expire_at?: string | null;
  new_user_group?: string;
  resource?: { id: number; name: string };
  message?: string;
  error?: string;
  code?: string;
}

function formatDate(s?: string | null) {
  if (!s) return '永久';
  const d = new Date(s);
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// 格式化激活码: 自动转大写 + 加横线 (XY-XXXX-XXXX-XXXX)
function formatCodeInput(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 6) return cleaned.slice(0, 2) + '-' + cleaned.slice(2);
  if (cleaned.length <= 10) return cleaned.slice(0, 2) + '-' + cleaned.slice(2, 6) + '-' + cleaned.slice(6);
  return cleaned.slice(0, 2) + '-' + cleaned.slice(2, 6) + '-' + cleaned.slice(6, 10) + '-' + cleaned.slice(10, 14);
}

export default function ActivatePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActivateResult | null>(null);
  const [logged, setLogged] = useState<boolean | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    // 探测登录态
    const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
    setLogged(!!t);
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const res = await fetch('/api/user/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(t ? { Authorization: 'Bearer ' + t } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ code: code.trim() }),
      });
      const data: ActivateResult = await res.json();
      if (!res.ok) {
        setResult({ success: false, error: data.error || '激活失败', code: data.code });
        return;
      }
      setResult(data);
      // VIP 成功 → 刷新本地登录态 (新权限)
      if (data.success && data.code_type === 'vip' && data.new_user_group) {
        const oldUser = JSON.parse(localStorage.getItem('user') || '{}');
        localStorage.setItem('user', JSON.stringify({ ...oldUser, user_group: data.new_user_group, expire_at: data.new_expire_at }));
      }
    } catch (e: any) {
      setResult({ success: false, error: '网络错误：' + (e?.message || '') });
    } finally {
      setLoading(false);
    }
  };

  const isValidFormat = code.replace(/-/g, '').length === 14 || code.replace(/-/g, '').length === 8;

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center p-4 relative overflow-hidden">
      {/* 背景动效 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-violet-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-pink-500/10 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="bg-[#12121a] rounded-2xl p-6 sm:p-8 border border-white/5 shadow-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold">激活码兑换</h1>
              <p className="text-xs text-white/40 mt-0.5">支持 VIP 会员码 / 单资源解锁码</p>
            </div>
          </div>

          {/* 登录提示 */}
          {logged === false && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>未登录无法兑换。
                <Link href="/login" className="underline ml-1 text-amber-200">先登录</Link>
                <span className="text-amber-400/60 ml-2">(登录后回到本页)</span>
              </div>
            </div>
          )}

          <AnimatePresence mode="wait">
            {result?.success ? (
              <SuccessView key="ok" result={result} router={router} />
            ) : (
              <form key="form" onSubmit={handleActivate} className="space-y-5">
                <div>
                  <label className="block text-sm text-white/60 mb-2">输入激活码</label>
                  <input
                    ref={inputRef}
                    type="text"
                    value={code}
                    onChange={(e) => setCode(formatCodeInput(e.target.value))}
                    placeholder="XY-XXXX-XXXX-XXXX"
                    maxLength={17}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-4 text-white placeholder-white/30 focus:outline-none focus:border-violet-500/50 font-mono tracking-wider text-center text-lg"
                  />
                  <div className="text-xs text-white/30 mt-1.5 text-center">
                    闲鱼码以 <span className="text-amber-400 font-mono">XY-</span> 开头 · 微店码以 <span className="text-pink-400 font-mono">WD-</span> 开头
                  </div>
                </div>

                {result && !result.success && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">{result.error}</div>
                      {result.code === 'already_used' && (
                        <div className="text-xs text-red-400/70 mt-1">如需协助请联系客服</div>
                      )}
                    </div>
                  </motion.div>
                )}

                <button
                  type="submit"
                  disabled={loading || !isValidFormat || logged === false}
                  className="w-full py-3.5 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
                >
                  {loading ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> 激活中...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> 立即激活</>
                  )}
                </button>
              </form>
            )}
          </AnimatePresence>

          {!result?.success && (
            <>
              <div className="mt-6 text-center text-sm text-white/40">还没有激活码？</div>
              <button
                onClick={() => router.push('/shop')}
                className="mt-3 w-full py-3 bg-gradient-to-r from-orange-500 to-amber-500 rounded-xl font-semibold hover:opacity-90 transition flex items-center justify-center gap-2"
              >
                <span>🛒</span>
                <span>前往购买</span>
              </button>
              <div className="mt-4 text-center text-xs text-white/30">
                闲鱼 / 微店购买后卖家会发送激活码<br />
                兑换后立即生效，无需等待
              </div>
            </>
          )}
        </div>

        <div className="mt-4 text-center">
          <Link href="/" className="text-sm text-white/30 hover:text-white/60 inline-flex items-center gap-1">
            <Home className="w-3 h-3" /> 返回首页
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

function SuccessView({ result, router }: { result: ActivateResult; router: any }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-4"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', duration: 0.6, delay: 0.1 }}
        className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center shadow-lg shadow-emerald-500/30"
      >
        <CheckCircle2 className="w-10 h-10 text-white" />
      </motion.div>

      <h2 className="text-2xl font-bold text-emerald-400 mb-2">🎉 激活成功！</h2>
      <p className="text-white/60 mb-6 text-sm">{result.message}</p>

      {/* VIP 详情卡 */}
      {result.code_type === 'vip' && (
        <div className="bg-gradient-to-br from-violet-500/10 to-pink-500/10 border border-violet-500/30 rounded-xl p-4 mb-4 text-left">
          <div className="flex items-center gap-2 mb-3">
            <Crown className="w-5 h-5 text-amber-400" />
            <span className="font-bold text-amber-300">{result.plan_label || 'VIP 会员'}</span>
            {result.duration_days === 0 ? (
              <span className="ml-auto px-2 py-0.5 bg-amber-500/20 text-amber-300 rounded text-xs font-medium">永久</span>
            ) : (
              <span className="ml-auto px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded text-xs font-medium">{result.duration_days} 天</span>
            )}
          </div>
          <div className="space-y-2 text-sm">
            {result.old_expire_at && (
              <div className="flex items-center gap-2 text-white/60">
                <span className="text-xs">原到期:</span>
                <span className="text-white/40 line-through">{formatDate(result.old_expire_at)}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-white/60">新到期:</span>
              <span className="text-emerald-400 font-mono font-medium">{formatDate(result.new_expire_at)}</span>
            </div>
            {result.channel && (
              <div className="flex items-center gap-2 text-white/50 text-xs">
                <Tag className="w-3 h-3" />
                <span>来源: {result.channel_label} · 批次 {result.batch_id}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 单资源解锁详情卡 */}
      {result.code_type === 'unlock' && result.resource && (
        <div className="bg-gradient-to-br from-sky-500/10 to-blue-500/10 border border-sky-500/30 rounded-xl p-4 mb-4">
          <div className="text-sm text-white/60 mb-1">已解锁资源</div>
          <div className="text-sky-300 font-medium">{result.resource.name}</div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => router.push('/')}
          className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-sm font-medium transition flex items-center justify-center gap-1"
        >
          <Home className="w-4 h-4" /> 回首页
        </button>
        {result.code_type === 'unlock' && result.resource?.id ? (
          <button
            onClick={() => router.push(`/resource/${result.resource!.id}`)}
            className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1"
          >
            查看资源 <ArrowRight className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => router.push('/tmdb-films')}
            className="flex-1 py-3 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl text-sm font-medium hover:opacity-90 transition flex items-center justify-center gap-1"
          >
            去看电影 <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
