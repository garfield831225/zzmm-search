import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { neon } = await import('@neondatabase/serverless');
  const { hashSync } = await import('bcryptjs');
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 补缺失的列
    await sql`ALTER TABLE xx_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'`.catch(() => {});
    await sql`ALTER TABLE xx_users ADD COLUMN IF NOT EXISTS expire_at TIMESTAMP`.catch(() => {});
    await sql`ALTER TABLE xx_users ADD COLUMN IF NOT EXISTS user_group VARCHAR(20) DEFAULT 'member'`.catch(() => {});
    await sql`ALTER TABLE xx_users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE xx_users ADD COLUMN IF NOT EXISTS last_login TIMESTAMP`.catch(() => {});

    // 删除并重建 admin（确保哈希正确）
    await sql`DELETE FROM xx_users WHERE username = 'admin'`.catch(() => {});
    const hashed = hashSync('zzmm2026', 10);
    await sql`
      INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
      VALUES ('admin', ${hashed}, 'admin', '2099-12-31', 'active', NOW(), NOW())
    `;

    return NextResponse.json({ success: true, message: '✅ admin / zzmm2026 已重建，列已补全' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}