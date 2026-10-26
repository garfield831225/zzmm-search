'use client';
// /admin/titles-settings - /titles 访问码 + 微信配置 管理
// 2026-10-22: 安全码后台可改, 改完立即生效 (不用发版)
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminTitlesSettingsPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [accessCode, setAccessCode] = useState('');
  const [wechat, setWechat] = useState('');
  const [wechatQr, setWechatQr] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/admin/titles-settings', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (r.status === 401 || r.status === 403) {
        setAuthed(false);
        router.push('/login?redirect=/admin/titles-settings');
        return;
      }
      const d = await r.json();
      setAuthed(true);
      setAccessCode(d?.accessCode || '2015');
      setWechat(d?.wechat || 'HKmaipanren');
      setWechatQr(d?.wechatQr || '/wechat-qr.png');
    } catch {
      setAuthed(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setMsg(null);
    if (!/^\d{4}$/.test(accessCode.trim())) {
      setMsg({ type: 'err', text: '安全码必须是 4 位数字' });
      return;
    }
    if (!wechat.trim()) {
      setMsg({ type: 'err', text: '微信号不能为空' });
      return;
    }
    if (!wechatQr.trim().startsWith('/')) {
      setMsg({ type: 'err', text: '二维码路径必须以 / 开头' });
      return;
    }
    setSaving(true);
    try {
      const t = localStorage.getItem('zzmm_token') || localStorage.getItem('token') || '';
      const r = await fetch('/api/admin/titles-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ accessCode: accessCode.trim(), wechat: wechat.trim(), wechatQr: wechatQr.trim() }),
      });
      const d = await r.json();
      if (!r.ok) {
        setMsg({ type: 'err', text: d?.error || '保存失败' });
      } else {
        setMsg({ type: 'ok', text: '已保存, 立即生效 ✅' });
        load();
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: e?.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  if (authed === null) {
    return <div className="p-8 text-center text-white/50">加载中...</div>;
  }
  if (!authed) {
    return <div className="p-8 text-center text-white/50">无权限, 正在跳转登录...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <h1 className="text-xl md:text-2xl font-bold mb-1">📑 目录页设置 (/titles)</h1>
      <p className="text-xs md:text-sm text-white/50 mb-6">
        配置 /titles 独立目录页的访问安全码 + 微信联系信息 (保存后立即生效, 不用发版)
      </p>

      {/* 安全码 */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-base">🔒</span>
          <div>
            <h2 className="font-semibold text-sm md:text-base">访问安全码</h2>
            <p className="text-[11px] text-white/45">进入 /titles 前需输入的 4 位数字</p>
          </div>
        </div>

        <label className="block text-xs text-white/50 mb-2">安全码 (4 位数字)</label>
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={accessCode}
          onChange={(e) => setAccessCode(e.target.value.replace(/\D/g, ''))}
          className="w-full sm:w-48 px-4 py-3 text-center text-2xl font-bold tracking-widest rounded-xl bg-black/30 border border-white/10 focus:border-amber-500/50 focus:outline-none"
          placeholder="2015"
        />
        <p className="text-[11px] text-white/35 mt-2">
          改完后, 用户重新进入 /titles 需要输入新安全码 (已发出去的 7 天 cookie 仍有效)
        </p>
      </div>

      {/* 微信 */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center text-base">💬</span>
          <div>
            <h2 className="font-semibold text-sm md:text-base">微信联系信息</h2>
            <p className="text-[11px] text-white/45">显示在 /titles 页面顶部的横幅</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs text-white/50 mb-2">微信号</label>
            <input
              type="text"
              value={wechat}
              onChange={(e) => setWechat(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-black/30 border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm"
              placeholder="HKmaipanren"
            />
          </div>
          <div>
            <label className="block text-xs text-white/50 mb-2">二维码图片路径</label>
            <input
              type="text"
              value={wechatQr}
              onChange={(e) => setWechatQr(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl bg-black/30 border border-white/10 focus:border-emerald-500/50 focus:outline-none text-sm font-mono"
              placeholder="/wechat-qr.png"
            />
          </div>
        </div>

        {/* 二维码预览 */}
        {wechatQr && (
          <div className="mt-4 flex items-center gap-3">
            <img
              src={wechatQr}
              alt="二维码预览"
              className="w-24 h-24 rounded-xl bg-white p-1"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
            <div className="text-[11px] text-white/40">
              二维码预览 (图片放在 public/ 目录, 部署时自动同步)
            </div>
          </div>
        )}
      </div>

      {/* 保存 */}
      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-6 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 disabled:opacity-50 font-semibold text-sm transition"
        >
          {saving ? '保存中...' : '💾 保存'}
        </button>
        {msg && (
          <span className={`text-sm ${msg.type === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>
            {msg.text}
          </span>
        )}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-amber-500/[0.08] border border-amber-500/20 text-[11px] text-white/50 leading-relaxed">
        <b className="text-amber-300">说明:</b> /titles 是独立目录页, 不需要登录账号, 只需要这个 4 位安全码。
        安全码存在数据库 (xx_system_settings), 后台改完立即生效, 不需要重新部署。
        校验接口: POST /api/titles/verify &#123; code &#125; (同一 IP 5 分钟内最多 10 次尝试)
      </div>
    </div>
  );
}
