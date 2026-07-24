import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';  // 2026-07-24: 改用 jose 库, Edge Runtime 友好

const JWT_SECRET_RAW = process.env.JWT_SECRET || 'cLWhs2015';
// jose 需要 Uint8Array 形式的 secret
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

// /vip/* 鉴权白名单: 哪些 user_group 可以进
const VIP_ALLOWED_GROUPS = new Set(['basic', 'vip', 'admin']);

// 不需要登录的路径（放行）
const PUBLIC_PATHS = [
  '/login',
  '/register',
  '/activate',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/auth/logout', // 2026-07-17 退出登录 (清 httpOnly cookie)
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
  // v2.1.4 单条定价 + admin 补全
  '/api/user/unlocks',         // 解锁记录列表 (后端 Bearer 鉴权)
  '/api/admin/pay-config',     // pay-config CRUD (后端 adminOnly 鉴权)
  '/api/admin/stats',          // 详细统计 (后端 adminOnly 鉴权, 含 /detailed 子路径)
  '/api/admin/invites',        // 邀请码管理 (后端 adminOnly 鉴权)
  '/api/admin/test-tmdb',      // TMDB 调试 endpoint (临时)
  '/api/admin/diag-cache',     // 2026-07-14 临时诊断: 看 batch 是否写入 xx_tmdb_cache
  '/api/admin/diag-tables',    // 2026-07-15 临时诊断: 看 cover 表是否存在
  '/api/admin/diag-bearer',    // 2026-07-15 临时诊断: 模拟 basic 用户调 search
  '/api/admin/diag-reclassify', // 2026-07-15 临时诊断: 查非 zezhe 资源分布 + 关键词命中
  '/api/admin/diag-null',       // 2026-07-15 临时诊断: 查 16k NULL 实际是 115 还是其他
  '/api/admin/diag-all',        // 2026-07-15 临时诊断: 全面调研 (xx_games/非115/关键词)
  '/api/admin/diag-access',     // 2026-07-15 临时诊断: 按 access_level 查 3 段分类逻辑
  '/api/admin/diag-full',       // 2026-07-16 临时诊断: 全库表 + vip 文档找法
  '/api/admin/diag-exclusive',  // 2026-07-16 临时诊断: exclusive_zone + resources 表深查
  '/api/admin/diag-inactive',   // 2026-07-16 临时诊断: 16k inactive 详查
  '/api/admin/dryrun-activate', // 2026-07-16 临时诊断: 16k inactive 激活预览+执行
  '/api/admin/fix-109',         // 2026-07-16 临时诊断: 把 109 tg 资源改成 vip 一致性
  '/api/admin/diag-migrate-tg-l3', // 2026-07-16 TG L3 一次性迁移 (l3_from 列 + xx_telegram_l3_queue 表)
  '/api/admin/diag-migrate-resource-links', // 2026-07-17 资源-链接 1对N 一次性迁移 (xx_resource_links + xx_link_feedback)
  '/api/admin/migrate-old-data',  // 2026-07-17 老数据入副表 (xx_resources → xx_resource_links)
  '/api/admin/links',             // 2026-07-17 admin 改/删资源链接
  '/api/admin/resources',         // 2026-07-20 admin 删整个资源 (双轨鉴权)
  '/api/admin/sync-pooler',      // 2026-07-20 admin 强制同步 Neon read replica (防 Vercel 函数 lag)
  '/api/admin/diag-direct',      // 2026-07-20 临时诊断 Vercel neon endpoint
  '/api/admin/diag-tg-analyze',  // 2026-07-21 临时诊断: 重跑 TG JSON 只统计不入库
  '/api/admin/sync-now',         // 2026-07-21 临时: 强制主 endpoint 同步 (修 read replica lag)
  '/api/admin/diag-replica',     // 2026-07-21 临时: 看 read replica 状态 + replication lag
  '/api/admin/check-by-id',       // 2026-07-21 临时: 查指定 id 真实状态 (主 endpoint 走 sync-now)
  // 2026-07-24 zzmm-vip 影视区: API 层鉴权, 走 page 层 JWT 解码
  '/api/vip',                       // 列表/详情 API (由路由内自己校验 group)
  // 2026-07-24 zzmm-vip 影视区 (页面层鉴权在 middleware 里, API 自己读 JWT 二次验证)
  '/api/vip',                       // 列表 API (中间件只挡 /vip/* 页面, API 由路由内 user_group 校验)
  '/api/feedback',                // 2026-07-17 用户失效反馈 (Bearer 内部鉴权)
  '/api/admin/feedback',          // 2026-07-17 admin 反馈处理 (Bearer 内部鉴权)
  '/api/diag-multi-link',         // 2026-07-17 diag: 找多网盘资源示例
  '/api/diag-delete-link',        // 2026-07-17 diag: 验证 admin/links DELETE 端点
  '/api/diag-import-result',      // 2026-07-18 diag: TG 导入 + 匹配统计
  '/api/diag-recent-tg',          // 2026-07-18 diag: 最近 N 小时 TG 新增
  '/api/diag-migrate-unique',     // 2026-07-18 diag: 改 UNIQUE 约束
  '/api/diag-by-source-cat',       // 2026-07-18 diag: 按 source/category 分布
  '/api/admin/backfill-sort1',    // 2026-07-18 一次性 - 回填 sort=1 副表
  '/api/diag-test-tg-import',     // 2026-07-18 diag: 模拟 admin 测 tg-json 端点
  '/api/diag-schema',             // 2026-07-18 diag: 查 schema
  '/api/admin/dedup-links',       // 2026-07-18 链接去重 (按 url 保留最新)
  '/api/admin/cleanup-dmhy-nav',  // 2026-07-18 清理 dmhy 导航站脏数据 (业务规则: 导航站直接删)
  '/api/admin/reclassify-magnet', // 2026-07-18 重分类 "磁力" 分类 (关键词库升级后老数据未自动重分类)
  '/api/catalog',                // 2026-07-18 /titles 独立目录页 API (无登录, 纯目录)
  '/api/library/sheets',         // 2026-07-18 /library 泽泽妈妈区 sheet 列表 (公开浏览, 后端按权限过滤)
  '/api/admin/diag-magnet-vip',  // 2026-07-18 临时诊断: VIP magnet 为什么只 2 条
  '/api/admin/diag-route-source', // 2026-07-18 临时诊断: 查 search API 部署源码
  '/api/admin/trigger-match',    // 2026-07-18 admin 强制触发 match-task (绕过 read replica lag)
  '/titles',                     // 2026-07-18 独立目录页 (无登录, 纯目录浏览, 无导航入口)
  '/api/admin/seed-multi-link-demo', // 2026-07-17 diag: 给老资源加示例多网盘链接
  '/api/admin/test-unnest',       // 2026-07-17 调试 UNNEST (已删, 白名单保留无影响)
  '/api/admin/diag-admin-group',  // 2026-07-16 查 admin 用户真实 group
  '/api/admin/diag-cookies',     // 2026-07-17 查服务端实际收到什么 cookie
  '/api/admin/diag-library-zones',  // 2026-07-16 验证 /library 三区 SQL 过滤
  '/admin',                       // 2026-07-17 极简化: 客户端 localStorage 鉴权, middleware 不挡
  '/api/admin/import/tg-json',   // 2026-07-16 TG JSON 上传导入 (VIP/admin, 内部鉴权)
  '/api/admin/import/tg-l3-worker', // 2026-07-16 TG L3 worker (status + process, VIP/admin)
  '/api/cron',                    // 2026-07-16 Vercel cron 调用 (match-task, tg-l3-worker)
  // /api/resources/unlock 资源解锁 (后端 Bearer 鉴权, 双模式) - 用 startsWith 通配
  // /api/resources/[id]/unlock-status 动态路由也走 unlock 路径检查
];

export async function middleware(request: NextRequest) {
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

  // v2.1.4 push-to-match-bridge (走 Bearer admin token 鉴权)
  if (pathname.startsWith('/api/internal/push-to-match-bridge')) {
    return NextResponse.next();
  }

  // v2.1.4 import-bridge + tg-organize GET (走 Bearer admin token 鉴权)
  if (pathname.startsWith('/api/internal/push-to-bridge') || pathname.startsWith('/api/admin/tg-organize')) {
    return NextResponse.next();
  }

  // 2026-07-24 zzmm-vip 影视区: /vip/* 改用 client-side 鉴权 (page.tsx useEffect 检查 token)
  // middleware 不再拦截, 避免 RSC fetch 被重定向导致白屏
  // 安全性: API 层 /api/vip 自己检查 JWT (更安全, 不依赖 cookie)
  if (pathname === '/vip' || pathname.startsWith('/vip/')) {
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