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

  // 3. 查/创用户 + 创 lumen 行
  const existing = await sql`SELECT id FROM xx_users WHERE username = ${email} LIMIT 1` as any[];
  let userId: number;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    const inserted = await sql`INSERT INTO xx_users (username, password_hash, user_group, status, is_verified, created_at, updated_at)
                              VALUES (${email}, '', 'user', 'active', true, NOW(), NOW()) RETURNING id` as any[];
    userId = inserted[0].id;
  }
  // 创 lumen 行 (if not exists)
  await sql`INSERT INTO xx_user_lumen (user_id, balance) VALUES (${userId}, 0) ON CONFLICT (user_id) DO NOTHING`;

  // 4. 加流明
  await sql`UPDATE xx_user_lumen SET balance = balance + ${lumen_amount}, updated_at = NOW() WHERE user_id = ${userId}`;

  // 5. 拿新余额
  const after = await sql`SELECT balance::int as balance FROM xx_user_lumen WHERE user_id = ${userId} LIMIT 1` as any[];
  console.log('[lumen-credit] userId:', userId, 'lumen_amount:', lumen_amount, 'after:', after[0]?.balance);

  // 6. 记录流水 (审计) - 用 xx_lumen_logs 表
  const newBalance = after[0]?.balance || 0;
  await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description)
            VALUES (${userId}, ${lumen_amount}, ${newBalance}, 'credit', ${activation_code_id ? String(activation_code_id) : null}, ${reason || 'internal_credit'})`.catch(() => {
    // 流水失败不阻塞
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
