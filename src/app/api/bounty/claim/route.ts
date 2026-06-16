// /api/bounty/claim - 接单
// body: { bounty_id }
// 状态: pending -> claimed
// 不锁定 lumen, 不扣流明 (押注在 creator 那边暂管)
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
  // 查单 + 防 creator 自接
  const r = await sql`SELECT id, creator_id, status FROM xx_bounty WHERE id = ${bountyId} LIMIT 1` as any[];
  if (!r[0]) return NextResponse.json({ error: '悬赏单不存在' }, { status: 404 });
  if (r[0].creator_id === userId) return NextResponse.json({ error: '不能接自己的单' }, { status: 400 });
  if (r[0].status !== 'pending') return NextResponse.json({ error: '该悬赏已被接/已结束, 状态: ' + r[0].status }, { status: 409 });

  // 抢单 (用 status=pending 条件更新, 防止 race)
  const upd = await sql`UPDATE xx_bounty SET claimer_id = ${userId}, status = 'claimed', claimed_at = NOW()
                        WHERE id = ${bountyId} AND status = 'pending'
                        RETURNING id` as any[];
  if (!upd[0]) return NextResponse.json({ error: '抢单失败 (可能被人抢先)' }, { status: 409 });

  return NextResponse.json({
    ok: true,
    bounty_id: bountyId,
    status: 'claimed',
    message: '✓ 抢单成功, 完成后请提交 (POST /api/bounty/submit)',
  });
}
