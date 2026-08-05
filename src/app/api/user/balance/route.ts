// /api/user/balance - 用户余额查询
// 返回: { lumen_balance, user_group, expire_at, vip_active }
// 2026-08-01: 改回 neon() SDK (rawNeon 在 next.js server 上跑仍有 ERR_INVALID_URL 问题, neon() SDK + fetchOptions no-store 验证 work)
// 2026-08-01: 用 parseNeonTime 修 Neon HTTP 端 timestamptz 缺 tz 标记 bug
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { isFutureTime, parseNeonTime } from '@/lib/time';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

// 2026-08-01: 修 Neon HTTP endpoint 5 分钟 stale cache (memory #9)
neonConfig.fetchConnectionCache = false;
const sql = neon(process.env.DATABASE_URL || '', {
  fetchOptions: { cache: 'no-store' },
});

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUserId(authHeader: string | null): { userId?: number; error?: string; status?: number } {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    return { userId: Number(payload.id) };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

export async function GET(req: NextRequest) {
  const auth = getUserId(req.headers.get('authorization'));
  if (auth.error || !auth.userId) return NextResponse.json({ error: auth.error || '未登录' }, { status: auth.status || 401 });

  // 2026-08-01: 改回 neon() SDK + fetchOptions no-store (stats/dashboard 路由已验证 work)
  //   SQL 里加 ::text 强转, 避免 Neon serverless 返 raw Date 在 JSON 序列化时丢 tz
  // 2026-08-05: 加 points 字段 (积分独立系统, 跟流明分开, memory #19)
  const rows = await sql`
    SELECT u.id, u.username, u.user_group,
           u.expire_at::text as expire_at,
           COALESCE(l.balance, 0)::int as lumen_balance,
           COALESCE(p.points, 0)::int as points
    FROM xx_users u
    LEFT JOIN xx_user_lumen l ON l.user_id = u.id
    LEFT JOIN xx_user_points p ON p.user_id = u.id
    WHERE u.id = ${auth.userId} LIMIT 1
  ` as any[];
  if (!rows[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  const u = rows[0];
  // 2026-08-01: 用 helper 判断 vip active (修 Neon 缺 tz 标记导致少 8 小时)
  const vipActive = (u.user_group === 'vip' || u.user_group === 'admin') && isFutureTime(u.expire_at);
  const expIso = parseNeonTime(u.expire_at);

  return NextResponse.json({
    ok: true,
    user_id: u.id,
    username: u.username,
    user_group: u.user_group,
    // 2026-08-01: 用 helper 返 ISO UTC 字符串, 防止前端 new Date() 解析错
    expire_at: expIso,
    vip_active: vipActive,
    lumen_balance: u.lumen_balance || 0,
    points: u.points || 0,
  });
}
