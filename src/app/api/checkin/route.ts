// 2026-08-04: P6.3 签到 API
//   - POST /api/checkin   每天 1 次, basic 1-5 积分 / vip/admin 8-20 积分
//   - 写 xx_point_logs (type='checkin') + 更新 xx_user_points.points
//   - ⚠️ 积分 = 独立系统, 跟流明 (xx_user_lumen) 分开! 任何时候都不要混!
//
// 2026-08-05 P10: 改用 getFreshUser() (DB 真实 user_group + lazy check 过期 VIP 降级)
//   - 之前用 payload.user_group (从 token 读), 旧 token 30 天有效, 过期 VIP 仍享 VIP 权益
//   - 血的教训 #26: lysq/lysg VIP 过期 4 天还能签到拿 8-20 积分
//   - 现在每次签到都查 DB 拿最新 user_group, 过期 VIP 自动 lazy check 降级

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { getFreshUser } from '@/lib/auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isVip(group: string): boolean {
  return group === 'vip' || group === 'admin';
}

export async function POST(request: NextRequest) {
  const user = await getFreshUser(request);
  if (!user) return NextResponse.json({ error: '需要登录' }, { status: 401 });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 检查今天是否已签到 (xx_point_logs 中 type='checkin' 且 created_at::date = today)
    const todayCheck = await sql`
      SELECT id FROM xx_point_logs
      WHERE user_id = ${user.id} AND type = 'checkin'
        AND created_at >= CURRENT_DATE::timestamp
        AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamp
      LIMIT 1
    `;
    if (todayCheck.length > 0) {
      // 已签到, 返当前余额 + already
      const bal = await sql`SELECT points FROM xx_user_points WHERE user_id = ${user.id}`;
      return NextResponse.json({
        success: false,
        already_checked_in: true,
        message: '今天已经签到过了, 明天再来',
        points_balance: bal[0]?.points || 0,
      });
    }

    // 算积分: basic 1-5, vip/admin 8-20
    const points = isVip(user.group) ? randInt(8, 20) : randInt(1, 5);

    // UPSERT xx_user_points (积分独立系统, 跟流明分开!)
    const exist = await sql`SELECT points FROM xx_user_points WHERE user_id = ${user.id}`;
    let newPoints = points;
    if (exist.length === 0) {
      await sql`INSERT INTO xx_user_points (user_id, points, updated_at) VALUES (${user.id}, ${points}, NOW())`;
    } else {
      newPoints = exist[0].points + points;
      await sql`UPDATE xx_user_points SET points = points + ${points}, updated_at = NOW() WHERE user_id = ${user.id}`;
    }

    // INSERT xx_point_logs (积分流水)
    await sql`
      INSERT INTO xx_point_logs (user_id, type, amount, ref_id, note, created_at)
      VALUES (${user.id}, 'checkin', ${points}, NULL, ${`每日签到: +${points} 积分`}, NOW())
    `;

    return NextResponse.json({
      success: true,
      already_checked_in: false,
      points,
      points_balance: newPoints,
      message: `✅ 签到成功! +${points} 积分`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const user = await getFreshUser(request);
  if (!user) return NextResponse.json({ error: '需要登录' }, { status: 401 });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 今天是否签到
    const todayCheck = await sql`
      SELECT id FROM xx_point_logs
      WHERE user_id = ${user.id} AND type = 'checkin'
        AND created_at >= CURRENT_DATE::timestamp
        AND created_at < (CURRENT_DATE + INTERVAL '1 day')::timestamp
      LIMIT 1
    `;

    // 最近 30 天签到记录
    const recent = await sql`
      SELECT id, amount, created_at, note
      FROM xx_point_logs
      WHERE user_id = ${user.id} AND type = 'checkin'
      ORDER BY created_at DESC
      LIMIT 30
    `;

    // 总积分
    const bal = await sql`SELECT points FROM xx_user_points WHERE user_id = ${user.id}`;

    return NextResponse.json({
      success: true,
      already_checked_in: todayCheck.length > 0,
      points_balance: bal[0]?.points || 0,
      recent: recent.map((r: any) => ({
        id: r.id,
        points: r.amount,
        createdAt: r.created_at,
        description: r.note,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
