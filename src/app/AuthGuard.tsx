'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// 2026-08-15 v2: 全局未登录跳 /login
//   - 用户硬要求: "所有页面只要是未登录的都直接跳登录页"
//   - 之前 useRequireAuth 只在 5 个用户级页面 (basic/upcoming/profile/themes/charts)
//   - 现在所有页面除白名单外, 没 token 直接 router.replace('/login?redirect=...')
//   - 白名单: 登录/注册/激活/协议/验证码门/preview - 这些公开
//
// 用法: layout.tsx 已经 import + render 了, 不需要在每个 page 改
//
// 行为:
//   - 白名单 (PUBLIC_PATHS) 内 → 不跳
//   - 白名单外 + 没 token → router.replace('/login?redirect=<原路径>')
//   - 白名单外 + 有 token → 不动 (具体页内 userGroup 鉴权自己处理)
//   - fetch 401 拦截 (保留原逻辑) → 静默清登录态 + 跳 /login

// 公开页白名单 (不需要登录就能访问)
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/activate',
  '/terms',
  '/titles-verify',
  '/preview-login',
];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  return false;
}

export default function AuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const installed = useRef(false);

  useEffect(() => {
    // 1. 未登录跳 /login (排除白名单)
    if (!isPublicPath(pathname)) {
      let token: string | null = null;
      try {
        token = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
      } catch {}
      if (!token) {
        const target = '/login?redirect=' + encodeURIComponent(pathname || '/');
        router.replace(target);
        return;
      }
    }

    // 2. 全局 fetch 401 拦截 (保留原逻辑): 401 自动清登录态 + 跳 /login
    if (installed.current) return;
    installed.current = true;

    const origFetch = window.fetch.bind(window);
    (window as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await origFetch(input, init);
      const url = typeof input === 'string' ? input : (input as any).url;
      // 只拦自家 API 的 401, 不拦 OAuth/第三方
      if (res.status === 401 && typeof url === 'string' && url.includes('/api/')) {
        const token = localStorage.getItem('zzmm_token');
        if (token) {
          // 静默清登录态
          try {
            localStorage.removeItem('zzmm_token');
            localStorage.removeItem('token');
            localStorage.removeItem('user');
          } catch {}
          // 跳登录 (排除本身已在登录页的情况)
          if (!pathname?.startsWith('/login')) {
            const target = '/login?redirect=' + encodeURIComponent(pathname || '/');
            router.push(target);
          }
        }
      }
      return res;
    };
  }, [router, pathname]);

  return null;
}
