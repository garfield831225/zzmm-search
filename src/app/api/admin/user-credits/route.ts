// 2026-07-29: 用户看板 - admin 看所有用户流明余额 + VIP 状态 + weekly credit
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    // 鉴权
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : req.cookies.get('zzmm_token')?.value;
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });
    let payload: any;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || '') as any;
    } catch {
      return NextResponse.json({ error: 'Token 无效' }, { status: 401 });
    }
    if (payload?.group !== 'admin') {
      return NextResponse.json({ error: '需要 admin 权限' }, { status: 403 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get('q') || '').trim();

    // 一次拿所有用户 + 流明余额 + weekly credit (LEFT JOIN)
    // xx_user_lumen.user_id 和 xx_user_weekly_credit.user_id 都是 integer, 但 xx_user_unlocks.user_id 是 text
    // xx_users.id 是 integer, 用 ::text cast 比较 (LATERAL 或 LEFT JOIN 都可以)
    const usersSql = q
      ? `WHERE u.username ILIKE $1 OR u.id::text = $1`
      : '';
    const params: any[] = q ? [`%${q}%`] : [];

    // 用 string 拼 SQL (参数已 sanitize)
    const queryStr = `
      SELECT
        u.id, u.username, u.user_group, u.status, u.expire_at,
        u.last_login, u.last_login_ip, u.last_login_city, u.created_at,
        COALESCE(l.balance, 0) as lumen_balance,
        wc.used as weekly_used, wc.total as weekly_total, wc.week_start,
        (SELECT count(*) FROM xx_user_unlocks ul WHERE ul.user_id = u.id::text) as unlock_count
      FROM xx_users u
      LEFT JOIN xx_user_lumen l ON l.user_id = u.id
      LEFT JOIN xx_user_weekly_credit wc ON wc.user_id = u.id
      ${usersSql}
      ORDER BY u.last_login DESC NULLS LAST, u.id DESC
      LIMIT 200
    `;
    const rows = await sql(queryStr, params) as any[];

    // 汇总统计
    const totalActive = rows.filter(r => r.status === 'active').length;
    const totalVip = rows.filter(r => r.user_group === 'vip' || r.user_group === 'admin').length;
    const totalLumen = rows.reduce((sum, r) => sum + (r.lumen_balance || 0), 0);

    return NextResponse.json({
      items: rows,
      total_active: totalActive,
      total_vip: totalVip,
      total_lumen_balance: totalLumen,
      total_users: rows.length,
    });
  } catch (e: any) {
    console.error('[admin/user-credits] error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
