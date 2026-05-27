import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606';

export async function POST(req: NextRequest) {
  try {
    const { username, password, captcha } = await req.json();

    // 验证码校验（可选，跳过也不阻止登录）
    const storedCaptcha = req.cookies.get('captcha_code')?.value || '';
    if (captcha && storedCaptcha && captcha.toLowerCase() !== storedCaptcha.toLowerCase()) {
      return NextResponse.json({ error: '验证码错误' }, { status: 400 });
    }

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    const rows = await sql`SELECT id, username, password_hash, user_group, expire_at, status FROM xx_users WHERE username = ${username}`;
    const users = rows as any[];

    if (!users.length) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const user = users[0];
    if (user.status !== 'active') {
      return NextResponse.json({ error: '账号已被禁用' }, { status: 403 });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    // 更新最后登录时间
    await sql`UPDATE xx_users SET last_login = NOW(), updated_at = NOW() WHERE id = ${user.id}`.catch(() => {});

    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.user_group },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        group: user.user_group,
        expire_at: user.expire_at,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}