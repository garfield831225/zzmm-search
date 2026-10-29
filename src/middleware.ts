import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';  // 2026-07-24: 改用 jose 库, Edge Runtime 友好
import { isFutureTime } from '@/lib/time';  // 2026-08-12: VIP/basic 过期实时踢

// 2026-10-14: Edge Runtime 不读 .env.production, 必须 hardcode 真秘 (跟 .env.production + login route sign 一致)
const JWT_SECRET_RAW = process.env.JWT_SECRET || '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606';
// jose 需要 Uint8Array 形式的 secret
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);

// /vip/* 鉴权白名单: 哪些 user_group 可以进
// 2026-10-14: 加 svip 跟 vip 一样可进 /vip/* (永久 SVIP)
const VIP_ALLOWED_GROUPS = new Set(['basic', 'vip', 'svip', 'admin']);

// 2026-10-22: /titles 访问码 cookie 名 (跟 /titles-verify 页设置的保持一致)
//   - 值固定 '1', 有效期 7 天
const TITLES_ACCESS_COOKIE = 'titles_2015';

// 不需要登录的路径（放行）
// 2026-08-14 收紧: 用户拍板"未登录只能在首页"
//   - 页面级路径: 只放行 / + /login + /register + /activate + /upgrade + /terms + /lovemovie
//   - API 级: 放行首页数据 + 登录 + 跨域 moviezone
//   - 拿掉 /basic /upcoming /nonfilm /library /vip /tmdb /charts /profile /request 等用户级页面
const PUBLIC_PATHS = [
  // 首页 (匿名能看) - 必须严格等于 pathname==='/' 否则 startsWith('/') 永远 true
  // 2026-10-14 fix: 单独处理, 放 PUBLIC_PATHS 会被 t.startsWith('/') 短路所有 path
  // 公开引导页
  '/login',
  '/register',
  '/activate',
  '/upgrade',
  '/terms',
  // 2026-10-20: /locked 是被锁定用户落地页 (locked_until > NOW() 时 middleware 302 过来)
  //   - 放 PUBLIC_PATHS 让 locked 用户能看到倒计时 + 解锁提示
  '/locked',
  // iframe 公开镜像
  '/lovemovie',
  // 2026-08-16 viewer-role: viewer 待审查看页 (公开, 不需要 token)
  '/pending-approval',
  // 详情页 (无 token 走 'user' 权限)
  '/tmdb',
  // 公开 titles 目录页 (2026-09-22 用户拍板: 无登录无验证, 本来就该公开)
  '/titles',
  '/titles-verify',
  // 登录 + 验证 API
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/captcha',
  // 首页数据 API (给 / 调)
  '/api/basic',
  '/api/upcoming',
  '/api/themes',
  '/api/catalog',
  '/api/tmdb/videos',
  '/api/nonfilm',
  // 搜索公开
  '/api/search',
  '/api/search/suggest',
  // 2026-10-29 B4: 首页「刚匹配上新」专区 API (跟 /api/search 同级别公开)
  //   - 数据范围不比 /api/search 大 (都是 active 资源的 tmdb_id + 名字), 无新增暴露面
  '/api/recently-matched',
  // 公共 API (跨域 moviezone + 子站)
  '/api/match-single',
  '/api/match-batch',
  '/api/charts',
  '/api/calendar',
  // 详情页 (无 token 走 'user' 权限)
  '/api/tmdb-resources',
  '/api/tmdb-credits',
  // 公开目录 + 标题
  '/api/titles',
  // 内部 API (Bearer 鉴权在 route.ts 内)
  '/api/internal/lumen/credit',
  '/api/auth/sso/redirect',
  '/api/auth/sso/callback',
  // 鉴权在 route.ts 内的 API (Bearer/cookie)
  '/api/watchlist',
  '/api/vip',
  '/api/vip-videos',
  '/api/vip-videos/hot',
  '/api/feedback',
  '/api/upload',
  '/api/requests',
  '/api/points/redeem',
  '/api/user/balance',
  '/api/user/activations',
  '/api/user/delete-account',
  '/api/user/weekly-credit',
  '/api/user/unlocks',
  '/api/user/activate',
  '/api/auth/activate',
  '/api/checkin',
  // admin (鉴权在 route.ts 内)
  '/api/admin/pending',
  '/api/admin/pending-users',
  // 2026-10-22: /titles 目录页设置 (安全码 + 微信配置, 鉴权在 route.ts 内 authAdmin)
  '/api/admin/titles-settings',
  '/api/admin/themes',
  '/api/admin/links',
  '/api/admin/resources',
  '/api/admin/feedback',
  '/api/admin/match-stats',
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
  '/api/admin/blacklist',
  '/api/admin/import/quick',
  '/api/admin/games/match',
  '/api/admin/games',
  '/api/admin/games',
  '/api/admin/bridge-health',
  '/api/admin/bridge-reconnect',
  '/api/admin/bridge-status',
  '/api/admin/invites',
  '/api/admin/pay-config',
  '/api/admin/test-tmdb',
  '/api/admin/import/tg-json',
  '/api/admin/import/tg-l3-worker',
  '/api/admin/trigger-match',
  '/api/admin/sync-pooler',
  '/api/admin/sync-now',
  '/api/admin/cleanup-dmhy-nav',
  '/api/admin/reclassify-magnet',
  '/api/admin/backfill-sort1',
  '/api/admin/dedup-links',
  '/api/admin/seed-multi-link-demo',
  '/api/admin/test-unnest',
  '/api/admin/diag-cache',
  '/api/admin/diag-tables',
  '/api/admin/diag-bearer',
  '/api/admin/diag-reclassify',
  '/api/admin/diag-null',
  '/api/admin/diag-all',
  '/api/admin/diag-access',
  '/api/admin/diag-full',
  '/api/admin/diag-exclusive',
  '/api/admin/diag-inactive',
  '/api/admin/dryrun-activate',
  '/api/admin/fix-109',
  '/api/admin/diag-migrate-tg-l3',
  '/api/admin/diag-migrate-resource-links',
  '/api/admin/diag-magnet-vip',
  '/api/admin/diag-route-source',
  '/api/admin/diag-direct',
  '/api/admin/diag-tg-analyze',
  '/api/admin/diag-replica',
  '/api/admin/diag-admin-group',
  '/api/admin/diag-cookies',
  '/api/admin/diag-library-zones',
  '/api/admin/check-by-id',
  '/api/admin/migrate-old-data',
  '/api/admin/diag-full',
  // diag 临时
  '/api/diag-multi-link',
  '/api/diag-delete-link',
  '/api/diag-import-result',
  '/api/diag-recent-tg',
  '/api/diag-migrate-unique',
  '/api/diag-by-source-cat',
  '/api/diag-test-tg-import',
  '/api/diag-schema',
  '/api/debug/games-test',
  // 资源 link (路由内自鉴权)
  '/api/resource/links-by-tmdb',
  // cron
  '/api/cron',
  '/api/cron/prepull-tmdb',
  // 其他
  '/api/library/sheets',
  '/api/tmdb-films',
  '/api/tmdb-search',
  '/api/stats2',
  '/api/hello',
  // admin 页面 (客户端鉴权)
  '/admin',
  '/admin/pending-users',
  // 静态资源
  '/logo',
  '/favicon',
  '/icon',
  '/manifest',
  // 2026-10-22: /titles 页的微信二维码 (public/wechat-qr.png)
  //   - 匿名用户要能看到二维码才能扫码加好友, 不能被踢到 /login
  '/wechat-qr.png',
  // 2026-10-29: 海报占位图 (public/poster-placeholder.svg)
  //   - 没海报的卡片用它兜底; 原来指向 TMDB 的 7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg 在官方上就是 404
  //   - ⚠️ 不加进白名单会被 middleware 307 到 /login → 浏览器把登录页 HTML 当图片解码 → 裂图
  //   - ⚠️ 以后 public/ 新增静态文件都要在这加一条 (middleware 比 Next.js 静态服务先跑)
  '/poster-placeholder.svg',
  // 2026-10-30 霓虹改版: Orbitron 自托管字体 (public/fonts/*.woff2)
  //   - ⚠️ 不加白名单 → 未登录用户(登录页/注册页)请求字体被 307 到 /login
  //     → 浏览器拿登录页 HTML 当 woff2 解码 → 字体失败 → 登录页标题退回系统字体
  //   - 登录页/注册页都是公开页, 它们的标题用了 .neon-title → 必须能拿到字体
  '/fonts',
  // 2026-08-14 拿掉的页面 (保留作为注释):
  // '/basic', '/upcoming', '/themes', '/nonfilm', '/library', '/vip', '/vip-videos',
  // '/tmdb', '/tmdb-films', '/request', '/profile', '/games', '/bounty', '/charts', '/titles', '/terms'
  // 2026-08-14 拿掉的页面 (用户级):
  // '/basic', '/upcoming', '/themes', '/nonfilm', '/library', '/vip', '/vip-videos',
  // '/tmdb', '/tmdb-films', '/request', '/profile', '/games', '/bounty', '/charts', '/titles', '/terms'
  // 2026-08-13: 公共 API batch 2+3 (moviezone + 子站)
  //   - /api/search 已有 CORS (route.ts 内 OPTIONS + headers), 不影响现有
  //   - /api/detail /api/nonfilm /api/search/suggest /api/exclusive-zone 全 Bearer 鉴权在 route 内
  //   - /api/basic /api/auth/* batch 1 已有
  '/api/detail',
  '/api/nonfilm',
  '/api/search/suggest',
  '/api/exclusive-zone',
];

// 2026-10-30: public/ 静态资源扩展名 (字体/图片/图标) —— 这些必须公开可取
//   见 middleware() 里的通用放行逻辑
const STATIC_ASSET_EXT = /\.(woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/i;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 2026-10-30: public/ 静态资源通用放行 (字体/图片/图标...)
  //   - 背景: middleware 比 Next.js 静态服务先跑, public/ 里的文件默认会被 307 到 /login
  //   - 这类文件本来就该公开 (它们是静态资源, 不是受保护的数据), 拦下来只是白跑一趟
  //   - 之前每次新增 public/ 文件都要手动加白名单条目, 漏了就出 bug (字体那次就是)
  //   - 只放行纯静态资源扩展名, 不碰 .json/.js/.css (那些走 _next/static, matcher 已排除)
  if (STATIC_ASSET_EXT.test(pathname)) {
    return NextResponse.next();
  }

  // 2026-08-04 P7: Preview 环境全放行 (生产环境没有 APP_ENV=preview 变量, 不受影响)
  // - middleware 完全跳过 token 校验
  // - admin/* /api/admin/* 全部放行
  // - route.ts 内部自己读 JWT 二次验证 (不变)
  if (process.env.APP_ENV === 'preview') {
    return NextResponse.next();
  }

  // 2026-09-22: /lovemovie 走 middleware 真 307 + Location (page.tsx redirect() 在 RSC streaming 时不发 Location,
  //   浏览器看到 __next_error__ HTML 中间态白屏). 子域名 lovemovie.zzmm-search.uk 自己处理 VIP 鉴权 (8688 server.py).
  if (pathname === '/lovemovie' || pathname.startsWith('/lovemovie?')) {
    return NextResponse.redirect(new URL('https://lovemovie.zzmm-search.uk/'), 307);
  }

  // 2026-10-22: /titles 是独立目录页 — 不需要登录, 只需要访问码
  //   - 用户原话: "https://zzmm-search.uk/titles 这个页面应该是单独的, 不需要登陆的, 只需要一个访问码的"
  //   - 之前 2026-09-22 删了验证码门, 结果 AuthGuard.tsx 白名单又漏了 /titles → 未登录被踢到 /login
  //   - 现在恢复访问码门 (cookie titles_2015, 7 天有效, /titles-verify 页设置)
  //   - 精确匹配 pathname === '/titles' (不能用 startsWith, 否则 /titles-verify 也被拦)
  //   - 已登录用户直接放行 (登录本身就是更高门槛, 不用再输码)
  if (pathname === '/titles') {
    const hasAccessCode = request.cookies.get(TITLES_ACCESS_COOKIE)?.value === '1';
    const hasToken = !!(request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value);
    if (!hasAccessCode && !hasToken) {
      const verifyUrl = new URL('/titles-verify', request.url);
      verifyUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(verifyUrl);
    }
    return NextResponse.next();
  }

  // 2026-09-22: /titles 不需要账密和登陆, 本来就是公开目录页
  //   - 用户原话: "另外 titles不需要账密和登陆呀和登陆呀，本身就是目录页给人看的"
  //   - 删掉 2026-08-04 加的 /titles 验证码门 (titles_2015 cookie 检查)
  //   - /titles-verify 页保留但不再被引用, 可后续清理

  // 2026-10-15: 首页 '/' 不再单独放行, 未登录用户访问 / 也跳到 /login
  //   - 用户原话: "未登录状态现在还能进首页, 还是要限制只能进入登录页"
  //   - 删掉原来的 `if (pathname === '/') return next();` 让 token check 兜底
  //   - /login /register /activate /pending-approval /api/auth/* 等 public paths 仍然在 PUBLIC_PATHS 里放行

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

  // 2026-08-16 viewer-role: viewer 用户能进 /library 路径 (文档资源浏览)
  //   - /library 已从 PUBLIC_PATHS 移除 (没登录会跳 login)
  //   - viewer pending 用户 status != 'active' → 后面会跳 login
  //   - viewer active / basic+ → 放行进 /library
  //   - 实现: 满足任意已登录 user_group (≠ 'user') 都放行, user_lock check 后面兜底
  // 2026-10-14 fix: 不在这里早放行 /library, 让 user_lock 检查生效 (user_group='user' 跳 /upgrade)
  // if (pathname.startsWith('/library')) {
  //   return NextResponse.next();
  // }

  // 2026-08-16 viewer-role: /pending-approval viewer 待审查看页 (公开, 不需要 token)
  //   - 用户从 register/login 跳过来, 还没 token, 也能看
  //   - 页面有 status check 拿 /api/auth/me 验真实状态
  if (pathname === '/pending-approval' || pathname.startsWith('/pending-approval/')) {
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
  // 2026-08-03: 改成 startsWith('/vip') 容错 /vip** 这种用户误输入 URL (之前 startsWith('/vip/') 漏掉)
  // 2026-10-14 fix: 不在这里早放行 /vip, 让 user_lock 检查生效 (user_group='user' 跳 /upgrade)
  // if (pathname.startsWith('/vip')) {
  //   return NextResponse.next();
  // }

  // 检查登录 cookie
  const token = request.cookies.get('zzmm_token')?.value ||
                request.cookies.get('token')?.value;

  if (!token) {
    // 未登录，重定向到登录页
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2026-07-29: 单点登录 - 校验 token iat vs user.last_login
  // 新登录会 UPDATE last_login=NOW(), 比 token.iat 新 → 旧 token 失效 → 跳登录 + Toast
  // admin 不挤 (怕自己误踢)
  // 2026-08-12: 加 VIP 过期实时降级 (用户原话: "vip 到期直接回 basic 组, 不是踢出")
  //   - user_group='vip' && expire_at < NOW() → UPDATE user_group='basic' + 放行 (不清 cookie, 不踢)
  //   - basic 用户永久, 不该有 expire_at 概念, 跳过 (cron 跑过后 expire_at 残留也不算过期)
  //   - admin 永久, 跳过
  //   - cron expire-vip-check 是兜底, 凌晨 4 点跑改 user_group (有 7.5h 滞后, middleware 补这个)
  try {
    const secret = new TextEncoder().encode(JWT_SECRET_RAW);  // 2026-10-15: 用 hardcoded 真秘 (Edge Runtime 不读 .env.production), 跟 line 7 一致
    const { payload } = await jwtVerify(token, secret);
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT last_login, status, user_group, expire_at, locked_until, lock_reason FROM xx_users WHERE id = ${payload.id} LIMIT 1` as any[];
    const u = r[0];

    // 2026-10-20 异常用户登录设计: locked_until 强制踢到 /locked
    // 2026-10-21 修正: 移到 admin 分支之外 — 用户拍板 "admin 豁免自动 ban, 但 locked 仍生效"
    //   - 自动 ban (cron) 排除 admin ✅ (cron 里 user_group <> 'admin')
    //   - 跨地域锁排除 admin ✅ (login route 里 isAdmin 跳过)
    //   - 所以 admin 只会被"管理员手动锁定"锁住 → 这是故意行为, 应生效
    //   - 解锁时间已过 → 中间件自动放过 (locked_until < NOW())
    if (u?.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
      const remainingSec = Math.max(0, Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 1000));
      const lockedUrl = new URL('/locked', request.url);
      lockedUrl.searchParams.set('reason', u.lock_reason || 'manual_ban');
      lockedUrl.searchParams.set('seconds', String(remainingSec));
      lockedUrl.searchParams.set('path', pathname);  // 解锁后回原页面
      return NextResponse.redirect(lockedUrl);
    }

    if ((payload as any)?.group !== 'admin') {
      if (!u || u.status !== 'active') {
        // 账号禁用/不存在 → 跳登录
        const r2 = new URL('/login', request.url);
        r2.searchParams.set('redirect', pathname);
        r2.searchParams.set('error', 'account_disabled');
        const res = NextResponse.redirect(r2);
        res.cookies.delete('zzmm_token');
        res.cookies.delete('token');
        return res;
      }
      // 2026-08-12: VIP 过期实时降级到 basic (不改 expire_at, 保留历史; 不清 cookie, 放行继续浏览)
      //   - 只查 vip, basic 永久不该有过期判断 (cron 改后 expire_at 残值不算过期)
      //   - isFutureTime(null) = true, 永久 vip 跳过
      // 2026-10-14: 永久 SVIP (user_group='svip') 永久不过期, 跳过降级
      if ((u.user_group === 'vip' || u.user_group === 'svip') && !isFutureTime(u.expire_at)) {
        try {
          await sql`UPDATE xx_users SET user_group = 'basic' WHERE id = ${u.id}`;
          // 写一条 lumen_logs 记录降级 (跟 cron 行为一致, 方便审计)
          await sql`
            INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
            VALUES (${u.id}, 0, 0, 'expire_middleware', NULL, ${`VIP 中间件实时降级 basic (expire_at=${u.expire_at})`}, NOW())
          `.catch(() => {});
        } catch (e) {
          // 降级失败 (db 问题) 也不影响本次访问, 让用户继续 (下次 cron 兜底)
          console.error('[middleware] vip->basic downgrade failed:', e);
        }
        // 不清 cookie, 不踢, 放行 (让用户继续浏览 basic 资源)
        return NextResponse.next();
      }
      const lastLoginMs = new Date(u.last_login).getTime();
      const tokenIatMs = ((payload as any).iat || 0) * 1000;
      if (tokenIatMs < lastLoginMs) {
        // 被挤下线
        const r3 = new URL('/login', request.url);
        r3.searchParams.set('redirect', pathname);
        r3.searchParams.set('kicked', '1');
        const res = NextResponse.redirect(r3);
        res.cookies.delete('zzmm_token');
        res.cookies.delete('token');
        return res;
      }
      // 2026-10-14: user_group='user' 锁紧 (注册默认, 未激活)
      //   - 只能看 /upgrade (need=activate 提示) + /activate + /pending-approval + /api/auth/* + /api/captcha + /api/user/activate + /logout
      //   - 其他路径 → 跳 /upgrade?need=activate
      if (u.user_group === 'user') {
        const isUserAllowed = (
          pathname === '/upgrade' ||
          pathname.startsWith('/upgrade/') ||
          pathname === '/activate' ||
          pathname.startsWith('/activate/') ||
          pathname === '/pending-approval' ||
          pathname.startsWith('/pending-approval/') ||
          pathname.startsWith('/api/auth/') ||
          pathname === '/api/captcha' ||
          pathname === '/api/user/activate' ||
          pathname === '/logout'
        );
        if (!isUserAllowed) {
          const up = new URL('/upgrade', request.url);
          up.searchParams.set('need', 'activate');
          return NextResponse.redirect(up);
        }
      }
    }
  } catch (e) {
    // verify 失败 / DB 失败 → 跳登录 (按未登录处理)
    const r4 = new URL('/login', request.url);
    r4.searchParams.set('redirect', pathname);
    return NextResponse.redirect(r4);
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