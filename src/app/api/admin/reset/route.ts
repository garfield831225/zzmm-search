import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (body.key !== process.env.JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const hashed = bcrypt.hashSync('zzmm2026', 10);

    // 重建管理员（无论是否存在）
    await sql`DELETE FROM xx_users WHERE username = 'admin'`.catch(() => {});
    await sql`
      INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
      VALUES ('admin', ${hashed}, 'admin', '2099-12-31', 'active', NOW(), NOW())
    `;

    // 重置所有激活码
    await sql`DELETE FROM xx_activation_codes`.catch(() => {});
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const codes = Array.from({ length: 15 }, () => `${seg()}-${seg()}-${seg()}`);
    for (const code of codes) {
      const days = Math.random() > 0.5 ? 30 : 90;
      await sql`INSERT INTO xx_activation_codes (code, days, batch_id, status, created_at) VALUES (${code}, ${days}, '重建批次', 'unused', NOW())`.catch(() => {});
    }

    return NextResponse.json({
      success: true,
      message: 'admin / zzmm2026 已重建，15个激活码已重置',
      sampleCodes: codes.slice(0, 5),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}