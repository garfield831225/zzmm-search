// 2026-08-05: getFreshUser() helper - 替代 getUser() 在所有用 token 判 user_group 的端点
//   血的教训 #26: lysq/lysg VIP 过期但旧 JWT 30 天有效, token 里 user_group='vip'
//     /api/checkin 等端点用 payload.user_group 判定 vip 积分 (8-20) vs basic (1-5)
//     拿 DB 里其实是 basic, 但 token 信任 vip → 用户继续拿 VIP 权益
//
// 修法: 每次调这个 helper 都从 DB 拿最新 user_group + expire_at + status
//       过期就 lazy check 降级 basic + 写 expire 流水
//       端点拿 helper 返的 user.group 是 DB 真实状态, 不被 token 缓存欺骗
//
// 用法:
//   import { getFreshUser } from '@/lib/auth';
//   const user = await getFreshUser(request);
//   if (!user) return NextResponse.json({ error: '需要登录' }, { status: 401 });
//   // user.group 是 DB 真实状态, 过期 VIP 已经降级
//
// ⚠️ 性能注意: 每次请求多 1 次 DB 查 (xx_users WHERE id = ?)
//   端点敏感性能的话可以加 Redis 缓存, 但目前先正确再优化

import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

export interface FreshUser {
  id: number;
  username: string;
  group: string;        // DB 真实 user_group, 过期 VIP 已被 lazy check 改成 'basic'
  userGroup: string;    // 别名, 跟 xx_users 字段对齐
  expireAt: string | null;
  status: string;
}

async function verifyToken(token: string): Promise<{ id: number; username: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      id: Number(payload.id),
      username: String(payload.username || ''),
    };
  } catch {
    return null;
  }
}

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7);
  }
  return req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || null;
}

export async function getFreshUser(req: NextRequest): Promise<FreshUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  const verified = await verifyToken(token);
  if (!verified) return null;

  const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });
  const rows = await sql`
    SELECT id, username, user_group, expire_at::text as expire_at, status
    FROM xx_users
    WHERE id = ${verified.id}
    LIMIT 1
  ` as any[];

  if (!rows.length) return null;
  const u = rows[0];

  // 2026-08-04 P8 + 2026-08-05 P10: VIP 过期 lazy check
  //   - user_group='vip' AND status='active' AND expire_at < now() → 降级 basic
  //   - 写 xx_lumen_logs type='expire' 流水
  //   - 这是双保险: NAS cron 每天跑 + 每个端点 lazy check
  if (u.user_group === 'vip' && u.status === 'active' && u.expire_at) {
    const expireMs = new Date(u.expire_at).getTime();
    if (expireMs < Date.now()) {
      try {
        await sql`UPDATE xx_users SET user_group = 'basic' WHERE id = ${u.id} AND user_group = 'vip'`;
        await sql`
          INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
          VALUES (${u.id}, 0, 0, 'expire', NULL, ${`VIP 过期降级 basic (lazy check via getFreshUser, expire_at=${u.expire_at})`}, NOW())
        `;
        u.user_group = 'basic';
      } catch (e: any) {
        console.error('[getFreshUser] lazy expire check failed:', e.message);
      }
    }
  }

  return {
    id: Number(u.id),
    username: String(u.username || ''),
    group: String(u.user_group || 'user'),
    userGroup: String(u.user_group || 'user'),
    expireAt: u.expire_at || null,
    status: String(u.status || 'active'),
  };
}

// 兼容老 getUser() 签名 (getUser() 旧实现有些返 { id, group, username } 形状)
//   - 新代码用 getFreshUser()
//   - 旧代码: 改 import + 调用 getFreshUser() 然后 .group 字段对齐
export async function getUser(req: NextRequest): Promise<{ id: number; group: string; username: string } | null> {
  const u = await getFreshUser(req);
  if (!u) return null;
  return { id: u.id, group: u.group, username: u.username };
}
