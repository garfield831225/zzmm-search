import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    let payload: any;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return NextResponse.json({ error: '登录已过期' }, { status: 401 });
    }

    const { code } = await req.json();
    if (!code || code.length < 8) {
      return NextResponse.json({ error: '卡密格式错误' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 查找卡密
    const codes = await sql`SELECT id, days, batch_id FROM xx_activation_codes WHERE code = ${code} AND status = 'unused'`;
    const codeRows = codes as any[];

    if (!codeRows.length) {
      return NextResponse.json({ error: '卡密无效或已使用' }, { status: 400 });
    }

    const codeInfo = codeRows[0];

    // 使用卡密
    await sql`UPDATE xx_activation_codes SET status = 'used', used_by = ${payload.id}, used_at = NOW() WHERE id = ${codeInfo.id}`.catch(() => {});

    // 更新用户过期时间
    const currentUser = await sql`SELECT expire_at, user_group FROM xx_users WHERE id = ${payload.id}` as any[];
    if (!currentUser.length) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const user = currentUser[0] as any;
    const now = new Date();
    let newExpire: Date;

    if (user.expire_at && new Date(user.expire_at) > now) {
      // 顺延
      newExpire = new Date(new Date(user.expire_at).getTime() + codeInfo.days * 86400000);
    } else {
      // 从今天开始
      newExpire = new Date(now.getTime() + codeInfo.days * 86400000);
    }

    await sql`UPDATE xx_users SET expire_at = ${newExpire.toISOString()}, user_group = 'member', updated_at = NOW() WHERE id = ${payload.id}`;

    return NextResponse.json({
      success: true,
      bonus_days: codeInfo.days,
      new_expire_at: newExpire.toISOString().slice(0, 10),
      new_group: 'member',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}