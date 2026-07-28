// 2026-07-28: 周免费额度查询 API
// 业务: VIP 每周 1 个免费解锁额度, 周日 0 点重置
// GET 返: { used, total, week_start, week_end, left }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    let token = '';
    if (auth?.startsWith('Bearer ')) {
      token = auth.replace('Bearer ', '');
    } else {
      token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || '';
    }
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });
    const payload = jwt.verify(token, JWT_SECRET) as any;
    const userId = String(payload.id);

    const sql = neon(process.env.DATABASE_URL || '');
    const userGroup = String(payload.user_group || payload.group || '').toLowerCase();
    const isVip = ['vip', 'admin'].includes(userGroup);

    // 2026-07-28: 修时区 bug — Neon serverless 默认 UTC, 跨周末会错乱
    // 改用 JS 算 (按 UTC+8 中国时区, 周日 0 点 = 本周开始)
    const nowMs = Date.now();
    const chinaMs = nowMs + 8 * 3600 * 1000;
    const chinaDate = new Date(chinaMs);
    const y = chinaDate.getUTCFullYear();
    const m = chinaDate.getUTCMonth();
    const d = chinaDate.getUTCDate();
    const dow = chinaDate.getUTCDay(); // 0=周日, 1=周一, ..., 6=周六
    const weekStartChina = new Date(Date.UTC(y, m, d - dow));  // 本周日 (中国时区) 0:00 = UTC 同日 16:00
    const weekStartDate = weekStartChina.toISOString().slice(0, 10);
    // 本周六 (中国时区) = 周日 + 6
    const weekEndChina = new Date(Date.UTC(y, m, d - dow + 6));
    const weekEndDate = weekEndChina.toISOString().slice(0, 10);

    if (!isVip) {
      // basic / user: 没周额度, 直接返 0/0
      return NextResponse.json({
        used: 0, total: 0, left: 0,
        week_start: weekStartDate, week_end: weekEndDate,
        eligible: false, reason: '需 VIP 才有周免费额度',
      });
    }

    // VIP: UPSERT 拿本周记录 (确保存在)
    await sql`
      INSERT INTO xx_user_weekly_credit (user_id, week_start, used, total, last_reset_at)
      VALUES (${userId}, ${weekStartDate}, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        week_start = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN ${weekStartDate}::date
          ELSE xx_user_weekly_credit.week_start
        END,
        used = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN 0
          ELSE xx_user_weekly_credit.used
        END,
        last_reset_at = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN NOW()
          ELSE xx_user_weekly_credit.last_reset_at
        END
    `;
    const rows = await sql`SELECT used, total FROM xx_user_weekly_credit WHERE user_id = ${userId}` as any[];
    const used = rows[0]?.used ?? 0;
    const total = rows[0]?.total ?? 1;

    return NextResponse.json({
      used, total,
      left: Math.max(0, total - used),
      week_start: weekStartDate,
      week_end: weekEndDate,
      eligible: true,
      user_group: userGroup,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
