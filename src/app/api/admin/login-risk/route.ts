// 2026-07-29: 登录 IP 风险监测 - admin 查看
// - 列出当天 (UTC+8) 有 ≥2 个城市 IP 的用户 (高风险)
// - 列出所有用户最近登录 IP (按 user_id 倒序)
// - 禁用/解禁账号
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

// 时区 (中国) → 当天起止时间
function todayRange(): { startISO: string; endISO: string; todayStr: string } {
  const chinaMs = Date.now() + 8 * 3600 * 1000;
  const today = new Date(chinaMs).toISOString().slice(0, 10);
  // 起始 = 中国 0:00 → UTC
  const startMs = chinaMs - (chinaMs % (24 * 3600 * 1000)) - 8 * 3600 * 1000;
  const endMs = startMs + 24 * 3600 * 1000;
  return {
    startISO: new Date(startMs).toISOString(),
    endISO: new Date(endMs).toISOString(),
    todayStr: today,
  };
}

export async function GET(req: NextRequest) {
  try {
    // 鉴权 (admin only)
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
    const { startISO, endISO, todayStr } = todayRange();

    // 1) 风险用户: 当天有 ≥2 个城市的用户
    const riskyUsers = await sql`
      SELECT user_id,
        array_agg(DISTINCT city ORDER BY city) FILTER (WHERE city IS NOT NULL) as cities,
        array_agg(DISTINCT ip) as ips,
        count(*) as login_count,
        max(login_at) as last_login
      FROM xx_login_history
      WHERE login_at >= ${startISO}::timestamptz AND login_at < ${endISO}::timestamptz
      GROUP BY user_id
      HAVING count(DISTINCT city) >= 2
      ORDER BY count(DISTINCT city) DESC, max(login_at) DESC
    ` as any[];

    // 取用户信息
    let riskyDetails: any[] = [];
    if (riskyUsers.length > 0) {
      const uids = riskyUsers.map((r) => r.user_id);
      const users = await sql`SELECT id, username, user_group, status, last_login_ip, last_login_city FROM xx_users WHERE id = ANY(${uids}::int[])` as any[];
      const userMap = new Map(users.map((u) => [u.id, u]));
      riskyDetails = riskyUsers.map((r) => ({ ...userMap.get(r.user_id), ...r }));
    }

    // 2) 所有用户最近登录 (按 last_login DESC, 限 50 个, 给 admin 看完整 IP 列表)
    const allUsers = await sql`
      SELECT id, username, user_group, status, last_login, last_login_ip, last_login_city
      FROM xx_users
      WHERE status = 'active'
      ORDER BY last_login DESC NULLS LAST
      LIMIT 50
    ` as any[];

    // 3) 今日总登录次数
    const totalLogins = await sql`SELECT count(*) as cnt FROM xx_login_history WHERE login_at >= ${startISO}::timestamptz AND login_at < ${endISO}::timestamptz` as any[];

    return NextResponse.json({
      today: todayStr,
      total_logins_today: parseInt(totalLogins?.[0]?.cnt || '0'),
      risky_users: riskyDetails,
      recent_logins: allUsers,
    });
  } catch (e: any) {
    console.error('[admin/login-risk] GET error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const { user_id, action } = body;
    if (!user_id || !action || !['ban', 'unban'].includes(action)) {
      return NextResponse.json({ error: '参数错误 (user_id, action: ban/unban)' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 防护: admin 不能 ban admin
    const target = await sql`SELECT user_group FROM xx_users WHERE id = ${user_id} LIMIT 1` as any[];
    if (!target[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    if (target[0].user_group === 'admin' && action === 'ban') {
      return NextResponse.json({ error: 'admin 不能被禁用' }, { status: 400 });
    }

    const newStatus = action === 'ban' ? 'banned' : 'active';
    await sql`UPDATE xx_users SET status = ${newStatus}, updated_at = NOW() WHERE id = ${user_id}`;

    return NextResponse.json({ ok: true, user_id, status: newStatus });
  } catch (e: any) {
    console.error('[admin/login-risk] POST error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
