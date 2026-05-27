import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function doSetup(sql: any): Promise<string[]> {
  const results: string[] = [];

  // 1. 创建用户表
  await sql`
    CREATE TABLE IF NOT EXISTS xx_users (
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
    )
  `;
  results.push('✅ xx_users 表创建成功');

  // 2. 创建激活码表
  await sql`
    CREATE TABLE IF NOT EXISTS xx_activation_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(50) UNIQUE NOT NULL,
      days INTEGER NOT NULL,
      batch_id VARCHAR(100),
      created_by INTEGER REFERENCES xx_users(id),
      used_by INTEGER REFERENCES xx_users(id),
      status VARCHAR(20) DEFAULT 'unused',
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    )
  `;
  results.push('✅ xx_activation_codes 表创建成功');

  // 3. 创建管理员账户
  const existingAdmin = await sql`SELECT id FROM xx_users WHERE username = 'admin'`;
  if ((existingAdmin as any[]).length === 0) {
    const hashed = bcrypt.hashSync('zzmm2026', 10);
    await sql`
      INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
      VALUES ('admin', ${hashed}, 'admin', '2099-12-31', 'active', NOW(), NOW())
    `;
    results.push('✅ 管理员账户创建：admin / zzmm2026');
  } else {
    results.push('ℹ️ 管理员已存在');
  }

  // 4. 生成初始激活码
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const genCode = () => `${seg()}-${seg()}-${seg()}`;

  const codeCount = await sql`SELECT count(*) as cnt FROM xx_activation_codes` as any[];
  if ((codeCount as any[])[0]?.cnt === 0) {
    const batches = [
      { count: 10, days: 30, batch: '初始批次' },
      { count: 5, days: 90, batch: '初始批次' },
    ];
    const generatedCodes: string[] = [];
    for (const b of batches) {
      for (let i = 0; i < b.count; i++) {
        const code = genCode();
        generatedCodes.push(code);
        await sql`
          INSERT INTO xx_activation_codes (code, days, batch_id, status, created_at)
          VALUES (${code}, ${b.days}, ${b.batch}, 'unused', NOW())
        `.catch(() => {});
      }
    }
    results.push(`✅ 生成了 ${generatedCodes.length} 个激活码`);
    results.push('示例：' + generatedCodes.slice(0, 3).join(' | '));
  } else {
    results.push('ℹ️ 激活码已存在');
  }

  return results;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.key !== process.env.JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    const sql = neon(process.env.DATABASE_URL || '');
    const results = await doSetup(sql);
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    if (key !== process.env.JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    const sql = neon(process.env.DATABASE_URL || '');
    const results = await doSetup(sql);
    return NextResponse.json({ success: true, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}