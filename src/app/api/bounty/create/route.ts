// /api/bounty/create - 发悬赏
// body: { title, description, reward }
// 押 reward lumen 进平台暂管 (creator 扣 lumen, status=pending)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

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
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const reward = Math.floor(Number(body.reward || 0));
  if (!title) return NextResponse.json({ error: '请输入标题' }, { status: 400 });
  if (!description) return NextResponse.json({ error: '请输入详细描述' }, { status: 400 });
  if (reward < 10) return NextResponse.json({ error: '悬赏最少 10 流明' }, { status: 400 });
  if (reward > 100000) return NextResponse.json({ error: '悬赏最多 10 万流明' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');

  // 创 lumen 行 (如果不存在)
  await sql`INSERT INTO xx_user_lumen (user_id, balance) VALUES (${userId}, 0) ON CONFLICT (user_id) DO NOTHING`;

  // 扣 lumen (用 RETURNING 拿新值, 防 stale read)
  const deduct = await sql`UPDATE xx_user_lumen SET balance = balance - ${reward}, updated_at = NOW()
                            WHERE user_id = ${userId} AND balance >= ${reward}
                            RETURNING balance` as any[];
  if (!deduct[0]) {
    return NextResponse.json({ error: '流明余额不足' }, { status: 402 });
  }
  const newBalance = deduct[0].balance;

  // 写流水
  await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, description, created_at)
            VALUES (${userId}, ${-reward}, ${newBalance}, 'debit', ${'悬赏押注: ' + title}, NOW())`;

  // 创悬赏单
  const ins = await sql`INSERT INTO xx_bounty (title, description, reward, creator_id, status, created_at)
                        VALUES (${title}, ${description}, ${reward}, ${userId}, 'pending', NOW())
                        RETURNING id, created_at` as any[];

  return NextResponse.json({
    ok: true,
    bounty_id: ins[0].id,
    new_balance: newBalance,
    status: 'pending',
    message: `✓ 悬赏发布成功, 押注 ${reward} 流明已暂管, 验收通过后给接单者`,
  });
}
