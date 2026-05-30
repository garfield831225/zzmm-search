import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET: 列出黑名单
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql('SELECT id, access_code, reason, created_at, created_by FROM xx_link_blacklist ORDER BY id DESC');
    return NextResponse.json({ success: true, list: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// POST: 添加访问码到黑名单
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    const { access_code, reason } = await request.json();
    if (!access_code) return NextResponse.json({ error: '缺少 access_code' }, { status: 400 });

    const sql = neon(process.env.DATABASE_URL || '');
    await sql('INSERT INTO xx_link_blacklist (access_code, reason) VALUES ($1, $2) ON CONFLICT (access_code) DO UPDATE SET reason = EXCLUDED.reason, created_at = NOW()', [access_code.trim(), reason || '']);

    // 立即删除数据库中已有含该访问码的记录
    const deleted = await sql('DELETE FROM xx_resources WHERE link LIKE $1 OR link LIKE $2 OR link_code = $3 RETURNING id', [`%password=${access_code}%`, `%password=${access_code}&%`, access_code.trim()]);

    return NextResponse.json({ success: true, code: access_code.trim(), deletedRows: deleted.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// DELETE: 从黑名单移除（不解锁已删除的记录）
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    const { access_code } = await request.json();
    if (!access_code) return NextResponse.json({ error: '缺少 access_code' }, { status: 400 });

    const sql = neon(process.env.DATABASE_URL || '');
    const result = await sql('DELETE FROM xx_link_blacklist WHERE access_code = $1 RETURNING id', [access_code.trim()]);
    return NextResponse.json({ success: true, removed: result.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}