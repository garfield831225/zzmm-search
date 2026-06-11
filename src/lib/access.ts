// ============================================================
// access.ts — 通用权限 helper
// 覆盖 4 类内容 (影视/游戏/音乐/文档) × 5 级用户 (未登录/user/basic/vip/admin)
// 用法:
//   const auth = await requireAccess(req, 'vip');
//   if (auth instanceof NextResponse) return auth;
//   // auth.user = { id, username, user_group, expire_at }
//   // ... 业务逻辑
// ============================================================
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { sql } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export type AccessLevel = 'free' | 'basic' | 'vip';

export interface AuthUser {
  id: number;
  username: string;
  user_group: string;       // 'user' | 'basic' | 'member' | 'vip' | 'admin'
  expire_at: string | null; // ISO string, null = 永久
  is_expired: boolean;      // vip 过期降级后的真实状态
  effective_group: string;  // 过期后的有效级别 (用于判断)
}

/**
 * 鉴权 + 降级
 * - level='free' : 任何登录用户 (含 basic/vip/admin), user 不能看 (除非资源本身 free)
 * - level='basic': basic + vip + admin (含历史遗留 'member')
 * - level='vip'  : 当前有效 vip + admin (vip 过期 → 降级 user → 拒绝)
 */
export async function requireAccess(
  req: NextRequest,
  level: AccessLevel
): Promise<AuthUser | NextResponse> {
  try {
  // 1. 拿 token (从 header / cookie / query)
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: '未登录', needLogin: true }, { status: 401 });
  }

  // 2. 验 JWT
  let payload: any;
  try {
    payload = jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return NextResponse.json({ error: 'Token 无效或过期', needLogin: true }, { status: 401 });
  }

  // 3. 查用户 (实时状态, 不靠 JWT 缓存)
  let user: any;
  try {
    const rows = await sql`
      SELECT id, username, user_group, expire_at, status
      FROM xx_users
      WHERE id = ${payload.id} AND status = 'active'
    ` as any[];
    user = rows[0];
  } catch (e: any) {
    console.error('[requireAccess] DB query failed:', e.message, 'payload.id:', payload.id);
    return NextResponse.json({ error: 'DB 错误', detail: e.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: '用户不存在或已禁用', needLogin: true }, { status: 401 });
  }

  // 4. 计算有效级别 (VIP 过期降级)
  const isExpired = !isVipActive(user.user_group, user.expire_at);
  const effectiveGroup = isExpired ? downgrade(user.user_group) : user.user_group;

  const authUser: AuthUser = {
    id: user.id,
    username: user.username,
    user_group: user.user_group,
    expire_at: user.expire_at ? new Date(user.expire_at).toISOString() : null,
    is_expired: isExpired,
    effective_group: effectiveGroup,
  };

  // 5. 权限判断
  if (level === 'free') {
    // free 只要登录, 所有人都放行
    return authUser;
  }
  if (level === 'basic') {
    // basic 需要 basic / vip / admin (含历史遗留 'member')
    if (['basic', 'member', 'vip', 'admin'].includes(effectiveGroup)) {
      return authUser;
    }
    return NextResponse.json(
      {
        error: '需要基础会员',
        need: 'basic',
        current: effectiveGroup,
        tip: '使用泽泽妈妈文档激活码开通基础会员',
      },
      { status: 403 }
    );
  }
  if (level === 'vip') {
    // vip 需要当前有效 vip / admin
    if (effectiveGroup === 'admin' || (effectiveGroup === 'vip' && !isExpired)) {
      return authUser;
    }
    return NextResponse.json(
      {
        error: '需要 VIP 会员',
        need: 'vip',
        current: effectiveGroup,
        is_expired: isExpired,
        expire_at: authUser.expire_at,
        tip: isExpired
          ? '您的 VIP 已过期, 请续费以继续使用游戏/音乐内容'
          : '升级 VIP 解锁游戏/音乐/高级内容',
      },
      { status: 403 }
    );
  }
  return NextResponse.json({ error: '未知的访问级别' }, { status: 500 });
  } catch (e: any) {
    console.error('[requireAccess] FATAL:', e.message, e.stack);
    return NextResponse.json({ error: '服务端错误', detail: e.message }, { status: 500 });
  }
}

/**
 * 仅 admin
 */
export async function requireAdmin(
  req: NextRequest
): Promise<AuthUser | NextResponse> {
  const auth = await requireAccess(req, 'free');
  if (auth instanceof NextResponse) return auth;
  if (auth.effective_group !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  return auth;
}

// ============================================================
// 内部 helpers
// ============================================================

function extractToken(req: NextRequest): string | null {
  // 1. Authorization: Bearer xxx
  const authHeader = req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. Cookie
  const cookieToken = req.cookies.get('token')?.value;
  if (cookieToken) return cookieToken;
  // 3. Query (?token=xxx) — 备用, 主要是图片/SSE 用
  const { searchParams } = new URL(req.url);
  const queryToken = searchParams.get('token');
  if (queryToken) return queryToken;
  return null;
}

/**
 * VIP 是否当前有效
 * - admin: 永远有效 (不查 expire_at)
 * - vip + expire_at=null: 永久 VIP
 * - vip + expire_at>now: 当前有效
 * - vip + expire_at<=now: 过期
 */
function isVipActive(userGroup: string, expireAt: string | Date | null): boolean {
  if (userGroup === 'admin') return true;
  if (userGroup !== 'vip') return false;
  if (!expireAt) return true; // 永久码
  const t = new Date(expireAt).getTime();
  return t > Date.now();
}

/**
 * 降级映射
 * vip → user (过期后失去 VIP 权限)
 * admin → admin
 * 其他 → 自身
 */
function downgrade(userGroup: string): string {
  if (userGroup === 'vip') return 'user';
  return userGroup;
}
