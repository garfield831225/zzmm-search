import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
// 2026-08-01: 修 Neon HTTP endpoint 5 分钟 stale cache (memory #9)
neonConfig.fetchConnectionCache = false;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  // 支持两种鉴权: Authorization header / query ?key=
  const auth = req.headers.get('authorization');
  let token = '';
  if (auth?.startsWith('Bearer ')) {
    token = auth.replace('Bearer ', '');
  } else {
    token = req.nextUrl.searchParams.get('key') || '';
  }
  if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });
  try {
    jwt.verify(token, JWT_SECRET);
  } catch { return NextResponse.json({ error: 'Token 无效' }, { status: 401 }); }

  const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

  // 4 张营收卡数据
  const codes = await sql`SELECT
    COUNT(*)::int as total,
    SUM(CASE WHEN is_used THEN 1 ELSE 0 END)::int as used,
    SUM(CASE WHEN is_used = false THEN 1 ELSE 0 END)::int as unused,
    SUM(CASE WHEN is_used THEN COALESCE(price_at_issue, 0) ELSE 0 END)::numeric as revenue
    FROM xx_activation_codes`;

  const users = await sql`SELECT
    COUNT(*)::int as total,
    SUM(CASE WHEN user_group IN ('basic', 'vip', 'admin') AND status = 'active' THEN 1 ELSE 0 END)::int as active_count,
    SUM(CASE WHEN user_group IN ('vip', 'admin') THEN 1 ELSE 0 END)::int as vip_count,
    SUM(CASE WHEN user_group IN ('vip', 'admin') AND (expire_at IS NULL OR expire_at > NOW()) THEN 1 ELSE 0 END)::int as vip_active
    FROM xx_users`;

  // 2026-08-01: 加资源总数 + 激活用户 (admin/dashboard 显示 "—" 原因)
  const resources = await sql`SELECT
    COUNT(*)::int as total,
    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)::int as active
    FROM xx_resources`;

  // 本月数据
  const monthCodes = await sql`SELECT
    COUNT(*)::int as generated,
    SUM(CASE WHEN is_used THEN 1 ELSE 0 END)::int as used,
    SUM(CASE WHEN is_used THEN COALESCE(price_at_issue, 0) ELSE 0 END)::numeric as revenue
    FROM xx_activation_codes
    WHERE created_at >= date_trunc('month', NOW())`;

  // 渠道分布
  const channelStats = await sql`SELECT
    channel,
    code_type,
    COUNT(*)::int as total,
    SUM(CASE WHEN is_used THEN 1 ELSE 0 END)::int as used
    FROM xx_activation_codes
    WHERE channel IS NOT NULL
    GROUP BY channel, code_type
    ORDER BY total DESC
    LIMIT 20`;

  // 最近 7 天趋势 (按天)
  const trend = await sql`SELECT
    DATE(created_at) as day,
    COUNT(*)::int as generated,
    SUM(CASE WHEN is_used THEN 1 ELSE 0 END)::int as used
    FROM xx_activation_codes
    WHERE created_at >= NOW() - INTERVAL '7 days'
    GROUP BY DATE(created_at)
    ORDER BY day`;

  // VIP 即将到期 (7 天内) - 挽留名单
  const expiringSoon = await sql`SELECT id, username, expire_at FROM xx_users
    WHERE user_group IN ('vip', 'admin')
    AND expire_at IS NOT NULL
    AND expire_at BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    ORDER BY expire_at ASC
    LIMIT 20`;

  // 已过期 VIP
  const expired = await sql`SELECT id, username, expire_at FROM xx_users
    WHERE user_group IN ('vip', 'admin')
    AND expire_at IS NOT NULL
    AND expire_at < NOW()
    ORDER BY expire_at DESC
    LIMIT 20`;

  return NextResponse.json({
    // 2026-08-01: 仪表盘顶部 4 个统计卡需要这 2 个字段 (admin/dashboard 显示)
    total_resources: resources[0]?.total || 0,
    active_resources: resources[0]?.active || 0,
    active_users: users[0]?.active_count || 0,
    // 4 张营收卡
    total_codes: codes[0]?.total || 0,
    used_codes: codes[0]?.used || 0,
    unused_codes: codes[0]?.unused || 0,
    total_revenue: Number(codes[0]?.revenue || 0),
    total_users: users[0]?.total || 0,
    vip_count: users[0]?.vip_count || 0,
    vip_active: users[0]?.vip_active || 0,
    month_generated: monthCodes[0]?.generated || 0,
    month_used: monthCodes[0]?.used || 0,
    month_revenue: Number(monthCodes[0]?.revenue || 0),
    channel_stats: channelStats,
    trend: trend,
    expiring_soon: expiringSoon,
    expired: expired,
  });
}