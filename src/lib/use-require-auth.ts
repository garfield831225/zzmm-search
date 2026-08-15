'use client';
// 2026-08-15 v2: useRequireAuth - client-side 鉴权 hook (替代不跑的 middleware)
//   根因: Next.js 14.2.5 standalone 模式不加载 middleware (vercel/next.js #62215 known bug)
//   修法: client-side 鉴权, 跟 /vip 模式一致
//
// 8-15 04:50 翻车真正根因 (v1 教训):
//   - v1 hook 返 { authChecked: boolean } + page 早期 return
//   - page.tsx 早期 return 在 useState 之前/之后都违反 hooks 规则
//   - 早期 return 在 useState 之前: useState 第二次渲染才调用, 顺序不一致 → React 抛错
//   - 早期 return 在 useState 之后: useState 第二次渲染没调用, 顺序不一致 → React 抛错
//   - 现象: Next.js global-error.tsx 触发 "页面加载出错"
//
// v2 修法:
//   - hook 不返 authChecked, 改返 { isLoggedIn, isReady }
//   - hook 内部 useEffect 拉 /api/auth/me, 401 自动 router.replace('/login?redirect=...')
//   - page.tsx 用 isReady 决定渲染: 始终先 return "加载中...", ready 之后正常渲染
//   - hooks 顺序: page 顶部 useState 都先调用, useRequireAuth 放最后, 永远不再 early return 在 hooks 之间
//
// 用法 (注意顺序!):
//   function BasicPage() {
//     const [tab, setTab] = useState('all');                  // 1. 所有 useState 提前
//     const [items, setItems] = useState<BasicItem[]>([]);     // 2. 其他 useState
//     const { isReady, userGroup } = useRequireAuth('/basic'); // 3. useRequireAuth 最后
//
//     if (!isReady) return <div>加载中...</div>;                // 4. early return 在所有 hooks 之后
//     // 渲染...
//   }
//
// 行为:
//   - localStorage 有 token + user → 立即 isReady=true
//   - localStorage 没 token → router.replace('/login?redirect=...')
//   - localStorage 有 token 但没 user → 拉 /api/auth/me 拿最新 group
//   - /api/auth/me 401 → localStorage 清除 + 跳 /login

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface UseRequireAuthResult {
  isReady: boolean;  // 鉴权检查完成 (true = 允许渲染页面, false = 等于 "加载中")
  userGroup: string | null;  // 'admin' | 'vip' | 'basic' | 'user' | null
  userId: number | null;
}

export function useRequireAuth(pathname: string): UseRequireAuthResult {
  const router = useRouter();
  // 1. 所有 useState 必须先调用, 不能在 useEffect / 早期 return 之后
  const [isReady, setIsReady] = useState(false);
  const [userGroup, setUserGroup] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      let token: string | null = null;
      let cachedUser: any = null;
      try {
        token = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
        const userJson = localStorage.getItem('user');
        if (userJson) cachedUser = JSON.parse(userJson);
      } catch {}

      if (!token) {
        if (!cancelled) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
        return;  // isReady 保持 false, 页面一直显示"加载中"
      }

      if (cachedUser) {
        const g = String(cachedUser.user_group || cachedUser.group || '').toLowerCase();
        if (!cancelled) {
          setUserGroup(g || null);
          setUserId(cachedUser.id || null);
          setIsReady(true);
        }
        return;
      }

      try {
        const r = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (r.status === 401) {
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
          try {
            localStorage.setItem('user', JSON.stringify(u));
            if (data?.token) localStorage.setItem('zzmm_token', data.token);
          } catch {}
          setIsReady(true);
          return;
        }
        router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      } catch (e) {
        if (!cancelled) router.replace(`/login?redirect=${encodeURIComponent(pathname)}`);
      }
    }

    check();
    return () => { cancelled = true; };
  }, [pathname, router]);

  return { isReady, userGroup, userId };
}
