'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// 全局 fetch 拦截: 401/403 自动清登录态 + 跳 /login (排除登录页本身)
export default function AuthGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const installed = useRef(false);

  useEffect(() => {
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
          localStorage.removeItem('zzmm_token');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          // 跳登录 (排除本身已在登录页的情况)
          if (!pathname.startsWith('/login')) {
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
