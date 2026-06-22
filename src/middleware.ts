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
  '/api/admin/batch-fix-category',
  '/api/admin/batch-update-category',
  '/api/admin/reset-resources',
  '/api/admin/network-test',
  '/api/admin/reset',
  '/api/admin/reset-tmdb',
  '/api/admin/migrate-tmdb-id',
  '/api/admin/add-sub-type',
  '/api/admin/reset-yuancategory',
  '/api/tmdb-films',
  '/tmdb-films',
  '/vip-videos',
  '/api/vip-videos',
  '/api/user/activate',
  '/activate',
  '/profile',
  '/api/user/activations',
  '/terms',
  '/api/vip-videos/hot',
  '/api/admin/import/quick',
  '/api/games',          // 游戏中心 API (后端 requireAccess 自鉴权)
  '/api/debug/games-test', // debug 端
  '/api/admin/games/match',  // 游戏匹配 (admin 鉴权, 后端判)
  '/api/admin/games',       // 游戏管理 API (admin 鉴权)
  // v1.2 跨站流明体系
  '/api/auth/sso/redirect',  // SSO 跳板 (免登录)
  '/api/auth/sso/callback',  // SSO 回调 (免登录, 内部验 token + 签 JWT)
  '/api/internal/lumen/credit',  // 内部 API: Moviezone 调加流明 (Bearer INTERNAL_API_TOKEN 鉴权)
  '/api/user/balance',         // 查余额 (后端 Bearer 鉴权)
  // /api/resources/unlock 资源解锁 (后端 Bearer 鉴权, 双模式) - 用 startsWith 通配
  // /api/resources/[id]/unlock-status 动态路由也走 unlock 路径检查
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 白名单：静态资源 + 公开页面
  for (const path of PUBLIC_PATHS) {
    if (pathname.startsWith(path)) {
      return NextResponse.next();
    }
  }

  // v1.2 资源路由通配: /api/resources/unlock 和 /api/resources/[id]/unlock-status
  if (pathname === '/api/resources/unlock' || pathname.match(/^\/api\/resources\/\d+\/unlock-status$/)) {
    return NextResponse.next();
  }

  // v2.1.3 悬赏专区 API (免登录浏览, 操作要登录)
  if (pathname.startsWith('/api/bounty/list') || pathname === '/bounty') {
    return NextResponse.next();
  }

  // v2.1.4 publish-v2 (走 Bearer token 鉴权, 跳过 cookie 检查)
  if (pathname.startsWith('/api/admin/publish') || pathname.startsWith('/api/admin/publish-v2')) {
    return NextResponse.next();
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