'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';

interface AdminTheme {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  status: string;
  created_at: string;
  item_count: number;
}

export default function AdminThemesPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [themes, setThemes] = useState<AdminTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newSort, setNewSort] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const pathname = usePathname();

  // 2026-08-03: admin 鉴权 (跟 /admin/dashboard 一致: localStorage.user.user_group === 'admin')
  useEffect(() => {
    try {
      const u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u?.user_group !== 'admin' && u?.group !== 'admin') {
        router.push('/login?redirect=/admin/themes');
        return;
      }
      setAuthed(true);
      setChecking(false);
    } catch {
      router.push('/login?redirect=/admin/themes');
    }
  }, [router]);

  const loadThemes = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/themes', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-store',
          'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || localStorage.getItem('token') || '') : ''),
        },
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const d = await r.json();
      setThemes(d.themes || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authed) loadThemes();
  }, [pathname, authed]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !newSlug.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/themes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || '') : ''),
        },
        body: JSON.stringify({ name: newName.trim(), slug: newSlug.trim().toLowerCase(), sort_order: newSort }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setNewName('');
      setNewSlug('');
      setNewSort(100);
      setShowCreate(false);
      await loadThemes();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: number) => {
    if (!confirm('删除这个主题? 主题下所有内容也会被软删')) return;
    try {
      const r = await fetch(`/api/admin/themes/${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || '') : ''),
        },
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadThemes();
    } catch (e: any) {
      alert('删除失败: ' + e.message);
    }
  };

  const onSortChange = async (id: number, newOrder: number) => {
    try {
      const r = await fetch(`/api/admin/themes/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (typeof window !== 'undefined' ? (localStorage.getItem('zzmm_token') || localStorage.getItem('adminToken') || '') : ''),
        },
        body: JSON.stringify({ sort_order: newOrder }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      await loadThemes();
    } catch (e: any) {
      alert('排序失败: ' + e.message);
    }
  };

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-[#0a0a0f] text-white/40 text-sm">校验登录态...</div>;
  }
  if (!authed) return null;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-xs text-white/40 hover:text-white/60">← 返回 admin</Link>
            <h1 className="text-2xl font-bold mt-1">🎬 主题专区管理</h1>
            <p className="text-xs text-white/40 mt-1">前台地址: <Link href="/themes" className="text-cyan-400 hover:underline">/themes</Link></p>
          </div>
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 rounded text-sm font-semibold">
            {showCreate ? '取消' : '+ 新建主题'}
          </button>
        </div>

        {/* 创建表单 */}
        {showCreate && (
          <form onSubmit={onCreate} className="bg-white/5 rounded-lg p-4 mb-6 space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-white/60">主题名</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="例: 漫威电影宇宙"
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-white/60">slug (URL)</label>
                <input
                  type="text"
                  value={newSlug}
                  onChange={e => setNewSlug(e.target.value)}
                  placeholder="例: mcu"
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm font-mono"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-white/60">排序 (越小越前)</label>
                <input
                  type="number"
                  value={newSort}
                  onChange={e => setNewSort(parseInt(e.target.value) || 100)}
                  className="w-full mt-1 px-3 py-2 bg-black/40 border border-white/10 rounded text-sm"
                />
              </div>
            </div>
            {error && <div className="text-red-400 text-xs">{error}</div>}
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded text-sm font-semibold">
                {submitting ? '创建中...' : '创建'}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-1.5 bg-white/10 hover:bg-white/20 rounded text-sm">
                取消
              </button>
            </div>
          </form>
        )}

        {/* 主题列表 */}
        {loading ? (
          <div className="text-center text-white/40 py-16">加载中...</div>
        ) : themes.length === 0 ? (
          <div className="text-center text-white/40 py-16">
            <div className="mb-3">还没有主题</div>
            <div className="text-xs">点 "+ 新建主题" 创建一个</div>
          </div>
        ) : (
          <div className="bg-white/5 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/5 text-white/60 text-xs">
                <tr>
                  <th className="text-left px-3 py-2">ID</th>
                  <th className="text-left px-3 py-2">名称</th>
                  <th className="text-left px-3 py-2">slug</th>
                  <th className="text-left px-3 py-2">状态</th>
                  <th className="text-left px-3 py-2">排序</th>
                  <th className="text-left px-3 py-2">内容数</th>
                  <th className="text-left px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {themes.map(t => (
                  <tr key={t.id} className="border-t border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 text-white/40">{t.id}</td>
                    <td className="px-3 py-2 font-semibold">{t.name}</td>
                    <td className="px-3 py-2 font-mono text-white/60 text-xs">/{t.slug}</td>
                    <td className="px-3 py-2">
                      {t.status === 'active' ? (
                        <span className="text-emerald-400 text-xs">● active</span>
                      ) : (
                        <span className="text-red-400 text-xs">● {t.status}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        defaultValue={t.sort_order}
                        onBlur={e => {
                          const v = parseInt(e.target.value);
                          if (v !== t.sort_order) onSortChange(t.id, v);
                        }}
                        className="w-16 px-2 py-0.5 bg-black/40 border border-white/10 rounded text-xs"
                      />
                    </td>
                    <td className="px-3 py-2 text-white/60">{t.item_count}</td>
                    <td className="px-3 py-2 space-x-2">
                      <Link href={`/admin/themes/${t.id}`} className="text-cyan-400 hover:underline text-xs">管理内容</Link>
                      <button onClick={() => onDelete(t.id)} className="text-red-400 hover:underline text-xs">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 text-xs text-white/40">
          提示: 主题下加内容 (TMDB 搜索选片) 在下一步 P5.3, 目前只能创建主题本身。
        </div>
      </div>
    </div>
  );
}
