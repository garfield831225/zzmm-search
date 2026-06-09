import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function POST(req: NextRequest) {
  try {
    // 限流: 单 IP 每小时最多 5 次注册
    const ip = getClientIp(req.headers);
    const rl = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: '注册太频繁，请 1 小时后再试', code: 'rate_limited', resetIn: Math.ceil(rl.resetIn / 1000) }, { status: 429 });
    }

    const { username, password, captcha } = await req.json();

    const storedCaptcha = req.cookies.get('captcha_code')?.value || '';
    if (!captcha || !storedCaptcha || captcha.toLowerCase() !== storedCaptcha.toLowerCase()) {
      return NextResponse.json({ error: '验证码错误' }, { status: 400 });
    }

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400 });
    }

    if (username.length < 3 || password.length < 6) {
      return NextResponse.json({ error: '用户名至少3位，密码至少6位' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 检查用户名是否已存在
    const exist = await sql`SELECT id FROM xx_users WHERE username = ${username}`;
    if ((exist as any[]).length > 0) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    // 加密密码
    const hashed = bcrypt.hashSync(password, 10);

    // 创建用户（默认普通会员）
    const result = await sql`
      INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
      VALUES (${username}, ${hashed}, 'member', NOW() + INTERVAL '30 days', 'active', NOW(), NOW())
      RETURNING id, username, user_group, expire_at
    `;

    const user = (result as any[])[0];
    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.user_group },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return NextResponse.json({
      token,
      user: { id: user.id, username: user.username, group: user.user_group, expire_at: user.expire_at },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}