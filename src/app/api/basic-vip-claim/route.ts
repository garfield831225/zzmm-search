// 2026-10-15: basic 每月领 1 天 vip 体验
//   - POST /api/basic-vip-claim  basic 用户每月 1 次
//   - GET  /api/basic-vip-claim  查本月是否已领
//   - 写 xx_basic_vip_claims (UNIQUE user_id+period_key 锁幂等)
//   - 激活 24h vip: user_group 临时升 vip, expire_at = NOW() + 1 day (admin/svip 不动)
//   - 过期降级由 middleware 兜底 (实时降级 logic)
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getFreshUser } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

function currentPeriodKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function GET(request: NextRequest) {
  const user = await getFreshUser(request);
  if (!user) return NextResponse.json({ error: '需要登录' }, { status: 401 });
  if (user.group !== 'basic') {
    return NextResponse.json({
      eligible: false,
      reason: '只有 basic 会员可领',
      user_group: user.group,
    });
  }

  try {
    const periodKey = currentPeriodKey();
    const rows = await sql`
      SELECT vip_expire_at, claimed_at FROM xx_basic_vip_claims
      WHERE user_id = ${user.id} AND period_key = ${periodKey}
      LIMIT 1
    ` as any[];

    return NextResponse.json({
      eligible: rows.length === 0,
      user_group: user.group,
      period_key: periodKey,
      claimed_this_month: rows.length > 0,
      vip_expire_at: rows[0]?.vip_expire_at || null,
      claimed_at: rows[0]?.claimed_at || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getFreshUser(request);
  if (!user) return NextResponse.json({ error: '需要登录' }, { status: 401 });
  if (user.group !== 'basic') {
    return NextResponse.json({ error: '只有 basic 会员可领 1 天 vip 体验' }, { status: 403 });
  }

  try {
    const periodKey = currentPeriodKey();

    // 检查本月是否已领 (UNIQUE 锁 + 应用层 check 双保险)
    const existing = await sql`
      SELECT vip_expire_at FROM xx_basic_vip_claims
      WHERE user_id = ${user.id} AND period_key = ${periodKey}
      LIMIT 1
    ` as any[];

    if (existing[0]) {
      return NextResponse.json({
        error: `本月已领过 1 天 vip 体验 (到期: ${existing[0].vip_expire_at}), 下月再来`,
        code: 'monthly_already_claimed',
        vip_expire_at: existing[0].vip_expire_at,
      }, { status: 429 });
    }

    // 临时升 vip 24h (admin 保护 - admin 不动, svip 永久不动)
    // 用 AT TIME ZONE 'Asia/Shanghai' 跟其他 expire_at 一致
    await sql`
      UPDATE xx_users
      SET user_group = CASE
            WHEN user_group = 'admin' THEN 'admin'
            WHEN user_group = 'svip' THEN 'svip'
            ELSE 'vip'
          END,
          expire_at = (NOW() + INTERVAL '1 day') AT TIME ZONE 'Asia/Shanghai',
          updated_at = NOW()
      WHERE id = ${user.id}
    `;

    // 写 claim 记录 (UNIQUE 防并发)
    await sql`
      INSERT INTO xx_basic_vip_claims (user_id, period_key, vip_expire_at)
      VALUES (${user.id}, ${periodKey}, (NOW() + INTERVAL '1 day') AT TIME ZONE 'Asia/Shanghai')
      ON CONFLICT (user_id, period_key) DO NOTHING
    `;

    return NextResponse.json({
      success: true,
      message: '🎉 1 天 vip 体验已激活! 24h 后自动降级 basic',
      period_key: periodKey,
      vip_expire_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}