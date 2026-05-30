import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// 不需要登录的路径（放行）
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/activate',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/captcha',
  '/api/search',
  '/api/admin/match-stats',
  '/api/admin/match-stats',
  '/api/stats2',
  '/api/hello',
  '/api/admin/blacklist',
  '/api/admin/stats',
  '/api/admin/codes',
  '/api/admin/users',
  '/api/admin/import',
  '/api/admin/match',
  '/api/admin/tmdb-match',
  '/api/admin/music-match',
  '/api/admin/cover-match',
  '/api/admin/setup',
  '/api/admin/simple-setup',
  '/api/admin/debug-db',
  '/api/admin/debug-env',
  '/api/admin/network-test',
  '/api/admin/reset',
  '/api/admin/reset-tmdb',
  '/api/admin/migrate-tmdb-id',
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 白名单：静态资源 + 公开页面
  for (const path of PUBLIC_PATHS) {
    if (pathname.startsWith(path)) {
      return NextResponse.next();
    }
  }

  // 检查登录 cookie
  const token = request.cookies.get('zzmm_token')?.value ||
                request.cookies.get('token')?.value;

  if (!token) {
    // 未登录，重定向到登录页
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * 匹配所有路径，排除：
     * - _next/static (静态文件)
     * - _next/image (图片优化)
     * - favicon.ico
     * - 公开 API（如 /api/admin/* 需要 admin 权限，这里统一放行，后端自己判断）
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};