// /api/bounty/submit - 接单者交稿
// body: { bounty_id, submission, submission_url? }
// 状态: claimed -> submitted
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
  const submission = String(body.submission || '').trim();
  const submissionUrl = String(body.submission_url || '').trim();
  if (!bountyId) return NextResponse.json({ error: '缺少 bounty_id' }, { status: 400 });
  if (!submission) return NextResponse.json({ error: '请输入交付说明' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`SELECT id, claimer_id, status FROM xx_bounty WHERE id = ${bountyId} LIMIT 1` as any[];
  if (!r[0]) return NextResponse.json({ error: '悬赏单不存在' }, { status: 404 });
  if (r[0].claimer_id !== userId) return NextResponse.json({ error: '只有接单者可提交' }, { status: 403 });
  if (r[0].status !== 'claimed') return NextResponse.json({ error: '状态错误: ' + r[0].status }, { status: 409 });

  await sql`UPDATE xx_bounty SET submission = ${submission}, submission_url = ${submissionUrl || null},
            status = 'submitted', submitted_at = NOW()
            WHERE id = ${bountyId} AND status = 'claimed'`;

  return NextResponse.json({
    ok: true,
    bounty_id: bountyId,
    status: 'submitted',
    message: '✓ 已交稿, 等发单者验收 (POST /api/bounty/confirm)',
  });
}
