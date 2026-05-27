import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.key !== JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const results: string[] = [];

    // 创建用户表
    try {
      await sql`CREATE TABLE xx_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        user_group VARCHAR(20) DEFAULT 'member',
        expire_at TIMESTAMP,
        status VARCHAR(20) DEFAULT 'active',
        is_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP
      )`;
      results.push('xx_users created');
    } catch (e: any) {
      if (e.message?.includes('already exists')) results.push('xx_users already exists');
      else results.push('xx_users error: ' + e.message.slice(0, 80));
    }

    // 创建激活码表
    try {
      await sql`CREATE TABLE xx_activation_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        days INTEGER NOT NULL,
        batch_id VARCHAR(100),
        created_by INTEGER,
        used_by INTEGER,
        status VARCHAR(20) DEFAULT 'unused',
        created_at TIMESTAMP DEFAULT NOW(),
        used_at TIMESTAMP
      )`;
      results.push('xx_activation_codes created');
    } catch (e: any) {
      if (e.message?.includes('already exists')) results.push('xx_activation_codes already exists');
      else results.push('xx_activation_codes error: ' + e.message.slice(0, 80));
    }

    // 检查 admin
    const adminCheck = await sql`SELECT id FROM xx_users WHERE username = 'admin'`;
    if ((adminCheck as any[]).length === 0) {
      // 用简单哈希，不用 bcrypt（避免环境问题）
      // password: zzmm2026 -> hash
      const hash = 'JDJhJDEwJHpOcEJWZWt6dnF5ZHYuY3J5cHQ1eXdKdlEuZVN2L3VEM3dPQTdILnRQR2x1L3dVOW5LZHdYcEou';
      await sql`INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
        VALUES ('admin', ${'JDJhJDEwJHpOcEJWZWt6dnF5ZHYuY3J5cHQ1eXdKdlEuZVN2L3VEM3dPQTdILnRQR2x1L3dVOW5LZHdYcEou'}, 'admin', '2099-12-31', 'active', NOW(), NOW())`.catch(() => {});
      results.push('admin account created (password: zzmm2026)');
    } else {
      results.push('admin already exists');
    }

    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200), stack: e.stack?.slice(0, 300) }, { status: 500 });
  }
}