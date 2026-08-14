'use client';
// 2026-08-15: useRequireAuth - client-side 鉴权 hook, 替代不跑的 middleware
//   根因: Next.js 14.2.5 standalone 模式不加载 middleware (vercel/next.js #62215 known bug)
//   修法: 在受保护页面 page.tsx 顶部 useRequireAuth('/pathname'), 未登录跳 /login
//   跟 /vip 页面 client-side 鉴权模式一致
//
// 用法:
//   'use client';
//   import { useRequireAuth } from '@/lib/use-require-auth';
//   export default function BasicPage() {
//     const { authChecked, userGroup } = useRequireAuth('/basic');
//     if (!authChecked) return <div>加载中...</div>;
//     // ... 渲染页面
//   }
//
// 行为:
//   - localStorage 有 token + user → 立即通过 (authChecked=true)
//   - localStorage 没 token → router.replace('/login?redirect=/pathname')
//   - localStorage 有 token 但没 user → fetch /api/auth/me 拿最新 user.group (含 expire_at 检查)
//   - /api/auth/me 返 401 → localStorage 清除 + 跳 /login

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface UseRequireAuthResult {
  authChecked: boolean;
  userGroup: string | null;  // 'admin' | 'vip' | 'basic' | 'user' | null
  userId: number | null;
}

export function useRequireAuth(pathname: string): UseRequireAuthResult {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [userGroup, setUserGroup] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // 1) localStorage 拿 token + user
      let token: string | null = null;
      let cachedUser: any = null;
      try {
        token = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
        const userJson = localStorage.getItem('user');
        if (userJson) cachedUser = JSON.parse(userJson);
      } catch {}

      if (!token) {
        // 2) 没 token → 跳 login
        if (!cancelled) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
        return;
      }

      // 3) 有 token + cached user → 直接通过 (fast path)
      if (cachedUser) {
        const g = String(cachedUser.user_group || cachedUser.group || '').toLowerCase();
        if (!cancelled) {
          setUserGroup(g || null);
          setUserId(cachedUser.id || null);
          setAuthChecked(true);
        }
        return;
      }

      // 4) 有 token 但没 cached user → 拉 /api/auth/me 拿最新 group
      try {
        const r = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (r.status === 401) {
          // token 失效 → 清缓存 + 跳 login
          try {
            localStorage.removeItem('zzmm_token');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          } catch {}
          router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
          return;
        }
        const data = await r.json();
        const u = data?.user || data;
        const g = String(u?.user_group || u?.group || '').toLowerCase();
        if (g) {
          setUserGroup(g);
          setUserId(u?.id || null);
          // 把 user 写回 localStorage (下次 fast path)
          try {
            localStorage.setItem('user', JSON.stringify(u));
            if (data?.token) localStorage.setItem('zzmm_token', data.token);
          } catch {}
          setAuthChecked(true);
          return;
        }
        // /api/auth/me 返 200 但没 user_group → 当作未登录
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      } catch (e) {
        // 网络错误 → 当作未登录, 保守起见跳 login
        if (!cancelled) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [pathname, router]);

  return { authChecked, userGroup, userId };
}
