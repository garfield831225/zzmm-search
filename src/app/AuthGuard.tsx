'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

// 2026-08-15 v2: 全局未登录跳 /login
//   - 用户硬要求: "所有页面只要是未登录的都直接跳登录页"
//   - 之前 useRequireAuth 只在 5 个用户级页面 (basic/upcoming/profile/themes/charts)
//   - 现在所有页面除白名单外, 没 token 直接 router.replace('/login?redirect=...')
//   - 白名单: 登录/注册/激活/协议/验证码门/preview - 这些公开
//
// 2026-08-17 viewer 限制 (用户拍板):
//   - viewer 档位只能访问: /library + /profile + /upgrade (流明购买) + /pending-approval + 公开页
//   - 访问其他页面 → 跳 /library
//   - /api/catalog 已返 unlocked 字段, viewer 解锁逻辑跟 basic 一样 (扣 lumen + 写 unlock)
//   - viewer 跟 vip/basic 一样能进 /library, 但 pay_type='code' 资源需要 basic+ 才能流明解锁
//   - 实现: AuthGuard 拿到 user_group, viewer 角色限定白名单
//
// 行为:
//   - 白名单 (PUBLIC_PATHS) 内 → 不跳
//   - 白名单外 + 没 token → router.replace('/login?redirect=<原路径>')
//   - 白名单外 + 有 token + viewer + 不在 VIEWER_ALLOWED_PATHS → router.replace('/library')
//   - 白名单外 + 有 token + 其他角色 → 不动 (具体页内 userGroup 鉴权自己处理)
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

// 2026-08-17: viewer 档位允许访问的页面 (其他都跳 /library)
const VIEWER_ALLOWED_PATHS = [
  '/library',         // 文档资源浏览 (核心功能)
  '/profile',         // 个人主页
  '/upgrade',         // VIP 购买引导
  '/shop',            // 商品购买
  '/user-credits',    // 积分
  '/activate',        // 兑换码激活 (lumen 兑换码)
  '/pending-approval', // 待审查看页
];

function isPublicPath(pathname: string | null): boolean {
  if (!pathname) return false;
  for (const p of PUBLIC_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  return false;
}

function isViewerAllowed(pathname: string | null): boolean {
  if (!pathname) return false;
  for (const p of VIEWER_ALLOWED_PATHS) {
    if (pathname === p || pathname.startsWith(p + '/')) return true;
  }
  return false;
}

// 2026-08-17: JWT payload 解析 (jose 库在 middleware 用了, 这里直接用 jwt-browser)
function getJwtPayload(): { group?: string; id?: number } | null {
  try {
    const token = localStorage.getItem('zzmm_token') || localStorage.getItem('token');
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    return { group: payload.group || payload.user_group, id: payload.id };
  } catch {
    return null;
  }
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

      // 2. 2026-08-17 viewer 档位限制: 只允许访问 library/profile/upgrade/shop/user-credits/pending-approval
      const payload = getJwtPayload();
      if (payload?.group === 'viewer' && !isViewerAllowed(pathname)) {
        router.replace('/library?restricted=1');
        return;
      }
    }

    // 3. 全局 fetch 401 拦截 (保留原逻辑): 401 自动清登录态 + 跳 /login
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
