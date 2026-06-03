import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUserId(authHeader: string | null): { userId?: string; error?: string; status?: number } {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    return { userId: String(payload.id) };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

export async function POST(req: NextRequest) {
  const auth = getUserId(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { code, resource_id } = body;

  if (!code || typeof code !== 'string' || !/^[A-Za-z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: '激活码格式错误（必须 8 位大小写字母数字）' }, { status: 400 });
  }
  if (!resource_id || !Number.isInteger(Number(resource_id))) {
    return NextResponse.json({ error: '缺少 resource_id' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // 1) 查码
  const codes = await sql`
    SELECT id, code, code_type, target_resource_id, price_at_issue,
           is_used, used_by, used_at, expires_at
    FROM xx_activation_codes
    WHERE code = ${code}
    LIMIT 1
  `;
  if (!codes[0]) {
    return NextResponse.json({ error: '激活码无效' }, { status: 404 });
  }
  const c = codes[0] as any;

  // 2) 校验类型 + 目标资源
  if (c.code_type !== 'unlock') {
    return NextResponse.json({ error: '该激活码不是资源解锁类型' }, { status: 400 });
  }
  if (c.target_resource_id !== Number(resource_id)) {
    return NextResponse.json({
      error: `该激活码只能解锁资源 #${c.target_resource_id}，不能用于 #${resource_id}`,
    }, { status: 400 });
  }

  // 3) 校验是否已用
  if (c.is_used) {
    return NextResponse.json({ error: '该激活码已被使用' }, { status: 409 });
  }

  // 4) 校验过期
  if (c.expires_at && new Date(c.expires_at) < new Date()) {
    return NextResponse.json({ error: '该激活码已过期' }, { status: 410 });
  }

  // 5) 校验用户未解锁过
  const existing = await sql`
    SELECT id FROM xx_user_unlocks
    WHERE user_id = ${auth.userId} AND resource_id = ${Number(resource_id)}
  `;
  if (existing[0]) {
    return NextResponse.json({ error: '您已解锁过此资源' }, { status: 409 });
  }

  // 6) 校验资源 pay_type='code'
  const resources = await sql`SELECT id, name, pay_type, code_price FROM xx_resources WHERE id = ${Number(resource_id)}`;
  if (!resources[0]) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  }
  if (resources[0].pay_type !== 'code') {
    return NextResponse.json({ error: '此资源不需要激活码' }, { status: 400 });
  }

  // 7) 写解锁记录 + mark 码已用（事务）
  try {
    await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${auth.userId}, used_at = NOW() WHERE id = ${c.id}`;
    await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, activation_code_id, unlocked_at) VALUES (${auth.userId}, ${Number(resource_id)}, ${c.id}, NOW())`;
  } catch (e: any) {
    return NextResponse.json({ error: '解锁失败: ' + e.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: '解锁成功！',
    resource: {
      id: resources[0].id,
      name: resources[0].name,
    },
  });
}
