// /api/bounty/cancel - 发单者撤单
// body: { bounty_id }
// 状态: pending/claimed -> cancelled
// 退 lumen: pending 全退, claimed 退一半 (50%) 平台截留补偿接单者
// 简化: pending 全退, claimed 不允许 (只能 confirm 或协商)
// v2.1.3 拍板: 0% 抽成 = 押 100% 退 100% (仅 pending 状态)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.replace('Bearer ', '') : '';
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  const userId = Number(user.id);
  const body = await req.json().catch(() => ({}));
  const bountyId = Number(body.bounty_id);
  if (!bountyId) return NextResponse.json({ error: '缺少 bounty_id' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`SELECT id, creator_id, reward, status FROM xx_bounty WHERE id = ${bountyId} LIMIT 1` as any[];
  if (!r[0]) return NextResponse.json({ error: '悬赏单不存在' }, { status: 404 });
  if (r[0].creator_id !== userId) return NextResponse.json({ error: '只有发单者可撤单' }, { status: 403 });
  if (r[0].status !== 'pending') {
    return NextResponse.json({ error: `已接单后无法直接撤单, 当前状态: ${r[0].status}, 请走协商或验收流程` }, { status: 409 });
  }

  // 退 lumen
  const refund = await sql`UPDATE xx_user_lumen SET balance = balance + ${r[0].reward}, updated_at = NOW()
                           WHERE user_id = ${userId} RETURNING balance` as any[];
  if (refund[0]) {
    await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, description, created_at)
              VALUES (${userId}, ${r[0].reward}, ${refund[0].balance}, 'credit', ${'悬赏撤单退款: ' + bountyId}, NOW())`;
  }
  await sql`UPDATE xx_bounty SET status = 'cancelled', cancelled_at = NOW() WHERE id = ${bountyId}`;

  return NextResponse.json({
    ok: true,
    bounty_id: bountyId,
    refund: r[0].reward,
    new_balance: refund[0]?.balance || 0,
    message: `✓ 撤单成功, 退回 ${r[0].reward} 流明`,
  });
}
