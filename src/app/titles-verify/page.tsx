'use client';
// 2026-10-22: /titles 访问码验证页 (安全码存 DB, 后台可改)
//   - 密码硬编码 '2015' → 改成调 /api/titles/verify 服务端比对
//   - 改码后台改完立即生效, 不用重新发版
//   - 输对 → setCookie titles_2015 + set sessionStorage → 跳 /titles
//   - 5 分钟内最多 10 次尝试 (服务端限流, 防暴力猜 4 位数字)
'use client';
import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function TitlesVerifyInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const value = code.trim();
    if (!/^\d{4}$/.test(value)) {
      setError('请输入 4 位数字安全码');
      return;
    }
    setSubmitting(true);

    try {
      // 服务端比对 (安全码在 DB, 后台可改)
      const res = await fetch('/api/titles/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.ok) {
        setError(data?.error || '❌ 安全码错误, 请重新输入');
        setSubmitting(false);
        return;
      }

      // 1) setCookie (让 middleware 放行, 持久 7 天)
      const expires = new Date();
      expires.setDate(expires.getDate() + 7);
      document.cookie = `titles_2015=1; expires=${expires.toUTCString()}; path=/; SameSite=Lax`;

      // 2) set sessionStorage (防 cookie 被禁)
      try { sessionStorage.setItem('titles_2015', '1'); } catch {}

      // 3) 跳 /titles
      const redirect = params.get('redirect') || '/titles';
      router.push(redirect);
    } catch (err: any) {
      setError('网络错误, 请重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="max-w-sm w-full rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/[0.05] to-orange-500/[0.05] p-6 backdrop-blur"
      >
        <div className="text-center mb-6">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-2xl">
            🔒
          </div>
          <h1 className="text-xl font-bold mb-1 neon-title">泽泽资源 - 进入验证</h1>
          <p className="text-xs text-white/50">
            请输入 4 位数字安全码以进入 /titles 页面
          </p>
        </div>

        <div className="mb-4">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="••••"
            autoFocus
            autoComplete="off"
            className="w-full px-4 py-3 text-center text-2xl font-bold tracking-widest rounded-lg bg-black/30 border border-white/10 focus:border-amber-500/50 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            disabled={submitting}
          />
        </div>

        {error && (
          <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs text-center">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || code.length !== 4}
          className="w-full py-2.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm transition"
        >
          {submitting ? '验证中...' : '进入 →'}
        </button>

        <div className="mt-4 text-[10px] text-white/30 text-center">
          (安全码 7 天内自动记忆, 可直接访问)
        </div>
      </form>
    </div>
  );
}

export default function TitlesVerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center">
        加载中...
      </div>
    }>
      <TitlesVerifyInner />
    </Suspense>
  );
}
