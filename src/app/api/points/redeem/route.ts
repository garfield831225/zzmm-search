// 2026-08-05: 积分兑流明 API
//   - POST /api/points/redeem { amount: 10 }
//   - 比例: 10 积分 = 1 流明
//   - 流程:
//     1) 鉴权
//     2) 查用户积分余额
//     3) 计算流明: amount 积分 → amount/10 流明 (向下取整)
//     4) 扣积分 + 加流明 + 写 2 条流水
//   - admin 也能兑换

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

async function getUser(request: NextRequest): Promise<{ id: number; group: string; username: string } | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  return null;
}

const POINTS_PER_LUMEN = 10;

export async function POST(request: NextRequest) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 });
  }

  const amount = parseInt(body.amount);
  if (!amount || amount < POINTS_PER_LUMEN) {
    return NextResponse.json({ error: `至少兑换 ${POINTS_PER_LUMEN} 积分 (1 流明)` }, { status: 400 });
  }
  if (amount % POINTS_PER_LUMEN !== 0) {
    return NextResponse.json({ error: `必须是 ${POINTS_PER_LUMEN} 的整数倍` }, { status: 400 });
  }
  if (amount > 10000) {
    return NextResponse.json({ error: '单次最多兑换 10000 积分 (1000 流明)' }, { status: 400 });
  }
  const lumenGet = Math.floor(amount / POINTS_PER_LUMEN);

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 查积分余额
    const ptsRows = await sql`SELECT points FROM xx_user_points WHERE user_id = ${user.id}`;
    const points = ptsRows[0]?.points ?? 0;
    if (points < amount) {
      return NextResponse.json({ error: `积分不足, 当前 ${points} 积分, 需要 ${amount} 积分` }, { status: 402 });
    }

    // 2) 查流明余额
    const lumRows = await sql`SELECT balance FROM xx_user_lumen WHERE user_id = ${user.id}`;
    const oldBalance = lumRows[0]?.balance ?? 0;
    const newBalance = oldBalance + lumenGet;
    const newPoints = points - amount;

    // 3) 扣积分
    await sql`UPDATE xx_user_points SET points = ${newPoints}, updated_at = NOW() WHERE user_id = ${user.id}`;
    await sql`
      INSERT INTO xx_point_logs (user_id, type, amount, ref_id, note, created_at)
      VALUES (${user.id}, 'redeem', ${-amount}, NULL, ${`兑换流明 ${POINTS_PER_LUMEN}:1, -${amount} 积分`}, NOW())
    `;

    // 4) 加流明
    if (lumRows.length === 0) {
      await sql`INSERT INTO xx_user_lumen (user_id, balance, updated_at) VALUES (${user.id}, ${newBalance}, NOW())`;
    } else {
      await sql`UPDATE xx_user_lumen SET balance = ${newBalance}, updated_at = NOW() WHERE user_id = ${user.id}`;
    }
    await sql`
      INSERT INTO xx_lumen_logs (user_id, type, change_amount, balance_after, ref_code, description, created_at)
      VALUES (${user.id}, 'points_redeem', ${lumenGet}, ${newBalance}, 'redeem', ${`积分兑换流明: ${amount} 积分 → ${lumenGet} 流明`}, NOW())
    `;

    return NextResponse.json({
      success: true,
      pointsBefore: points,
      pointsAfter: newPoints,
      lumenBefore: oldBalance,
      lumenAfter: newBalance,
      lumenGet,
      message: `✅ 兑换成功: ${amount} 积分 → ${lumenGet} 流明`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
