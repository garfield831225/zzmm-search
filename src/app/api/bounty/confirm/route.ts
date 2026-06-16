// /api/bounty/confirm - 发单者验收
// body: { bounty_id }
// 状态: submitted -> confirmed
// 付 lumen: reward 100% 给接单者 (0% 抽成)
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
  const r = await sql`SELECT id, creator_id, claimer_id, reward, status FROM xx_bounty WHERE id = ${bountyId} LIMIT 1` as any[];
  if (!r[0]) return NextResponse.json({ error: '悬赏单不存在' }, { status: 404 });
  if (r[0].creator_id !== userId) return NextResponse.json({ error: '只有发单者可验收' }, { status: 403 });
  if (r[0].status !== 'submitted') return NextResponse.json({ error: `状态错误: ${r[0].status}, 需先交稿` }, { status: 409 });
  if (!r[0].claimer_id) return NextResponse.json({ error: '接单者异常' }, { status: 500 });

  // 给接单者加 lumen (0% 抽成, 100% 给)
  await sql`INSERT INTO xx_user_lumen (user_id, balance) VALUES (${r[0].claimer_id}, 0) ON CONFLICT (user_id) DO NOTHING`;
  const credit = await sql`UPDATE xx_user_lumen SET balance = balance + ${r[0].reward}, updated_at = NOW()
                           WHERE user_id = ${r[0].claimer_id}
                           RETURNING balance` as any[];
  if (credit[0]) {
    await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, description, created_at)
              VALUES (${r[0].claimer_id}, ${r[0].reward}, ${credit[0].balance}, 'credit', ${'悬赏验收: ' + bountyId}, NOW())`;
  }
  await sql`UPDATE xx_bounty SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${bountyId}`;

  return NextResponse.json({
    ok: true,
    bounty_id: bountyId,
    reward: r[0].reward,
    claimer_id: r[0].claimer_id,
    claimer_new_balance: credit[0]?.balance || 0,
    message: `✓ 验收成功, ${r[0].reward} 流明已给接单者 (0% 抽成)`,
  });
}
