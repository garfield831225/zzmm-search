// /api/internal/lumen/credit - 内部 API
// Moviezone 端调此端点给 zzmm-search 用户加流明
// 鉴权: Authorization: Bearer <INTERNAL_API_TOKEN>
// POST { email, lumen_amount, activation_code_id?, reason }
// 返回 { ok, new_balance }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN; // 32 字节随机串, 自己生成, 不贴消息

export async function POST(req: NextRequest) {
  // 1. 鉴权
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized: missing Bearer token' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!INTERNAL_API_TOKEN || token !== INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 403 });
  }

  // 2. 解析 body
  const body = await req.json().catch(() => ({}));
  const { email, lumen_amount, activation_code_id, reason } = body;

  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: '缺少 email' }, { status: 400 });
  }
  if (!lumen_amount || typeof lumen_amount !== 'number' || lumen_amount <= 0 || lumen_amount > 10000) {
    return NextResponse.json({ error: 'lumen_amount 必须 1-10000 的正整数' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // 3. 查/创用户
  const existing = await sql`SELECT id, lumen_balance FROM xx_users WHERE username = ${email} LIMIT 1` as any[];
  let userId: number;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    const inserted = await sql`INSERT INTO xx_users (username, password_hash, user_group, status, is_verified, created_at, updated_at)
                              VALUES (${email}, '', 'user', 'active', true, NOW(), NOW()) RETURNING id` as any[];
    userId = inserted[0].id;
  }

  // 4. 加流明
  await sql`UPDATE xx_users SET lumen_balance = lumen_balance + ${lumen_amount} WHERE id = ${userId}`;

  // 5. 拿新余额
  const after = await sql`SELECT lumen_balance FROM xx_users WHERE id = ${userId} LIMIT 1` as any[];

  // 6. 记录流水 (审计) - 用 logs 表
  await sql`INSERT INTO xx_logs (user_id, action, details, created_at)
            VALUES (${userId}, 'lumen_credit', ${JSON.stringify({ lumen_amount, activation_code_id: activation_code_id || null, reason: reason || 'internal_credit' })}, NOW())`.catch(() => {
    // logs 表若 schema 不匹配, 不阻塞
  });

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email,
    lumen_amount,
    new_balance: after[0]?.lumen_balance || 0,
  });
}

// 健康检查
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!INTERNAL_API_TOKEN || token !== INTERNAL_API_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, message: 'internal lumen credit API is healthy' });
}
