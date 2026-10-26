// 2026-10-20 异常用户登录设计: 全 API 点击计数工具
//   - 主要 API (search/basic/catalog/auth/me/library/watchlist/checkin...) 在 route.ts 顶部加一行:
//       void recordClick(req, userId);
//   - 内部 INSERT xx_user_actions (fire-and-forget, 不阻塞主流程, 失败静默)
//   - phase 3 systemd timer 扫此表做 1h/24h 阈值检查 → 自动锁/封号
//   - 这里不放 middleware 是因为 Edge Runtime fire-and-forget 不可靠 (fetch promise 会在 response 后被 cancel)
import { NextRequest } from 'next/server';
import { getClientIp } from '@/lib/rate-limit';

// 跳过静态/心跳探测路径, 防止日志爆炸
const SKIP_PREFIXES = ['/favicon', '/icon', '/logo', '/manifest', '/_next'];
// 跳过 admin debug diag (有几百个, 每分钟刷一次, 计数噪声)
const SKIP_INFIX = ['/api/admin/diag-', '/api/diag-', '/api/debug/'];

function shouldSkip(path: string): boolean {
  if (SKIP_PREFIXES.some((p) => path.startsWith(p))) return true;
  if (SKIP_INFIX.some((p) => path.includes(p))) return true;
  return false;
}

// fire-and-forget click 记录
//   - userId 必有 (已登录用户的 API 行为才算)
//   - req 用于拿 IP + path (NextRequest 有 url.pathname)
//   - 失败静默吞错, 不影响主流程
export function recordClick(req: NextRequest, userId: number) {
  const pathname = req.nextUrl?.pathname || '';
  if (shouldSkip(pathname)) return;
  if (!userId || userId <= 0) return;
  const ip = getClientIp(req.headers, '');
  // 异步执行, 不返回 promise (fire-and-forget)
  void (async () => {
    try {
      // 直接动态 import neon, 避免 hot reload 路径冲突
      const { neon } = await import('@neondatabase/serverless');
      const sql = neon(process.env.DATABASE_URL || '');
      await sql`
        INSERT INTO xx_user_actions (user_id, action_type, ip, path)
        VALUES (${userId}, 'click', ${ip || null}, ${pathname.slice(0, 250)})
      `;
    } catch (e: any) {
      // 计数失败 = 漏一条, 不影响主业务
      // eslint-disable-next-line no-console
      console.error('[recordClick] insert failed:', e?.message);
    }
  })();
}
