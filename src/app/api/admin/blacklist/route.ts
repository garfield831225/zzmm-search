import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// 兼容旧 ?key= 调用
function legacyAuth(request: NextRequest) {
  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (key === JWT_SECRET) return true;
  return false;
}

export async function GET(request: NextRequest) {
  // 优先 Bearer 鉴权, 兼容 ?key= JWT_SECRET
  const a = adminOnly(request.headers.get('authorization'));
  if (a.error && !legacyAuth(request)) {
    return NextResponse.json({ error: a.error }, { status: a.status });
  }
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`SELECT id, access_code, reason, created_at, created_by FROM xx_link_blacklist ORDER BY id DESC LIMIT 200`;
    return NextResponse.json({ success: true, list: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const a = adminOnly(request.headers.get('authorization'));
  if (a.error && !legacyAuth(request)) {
    return NextResponse.json({ error: a.error }, { status: a.status });
  }
  try {
    const { access_code, reason } = await request.json();
    if (!access_code) return NextResponse.json({ error: '缺少 access_code' }, { status: 400 });
    const sql = neon(process.env.DATABASE_URL || '');
    await sql`INSERT INTO xx_link_blacklist (access_code, reason, created_by, created_at)
              VALUES (${access_code}, ${reason || ''}, ${a.payload ? String(a.payload.id) : 'system'}, NOW())
              ON CONFLICT (access_code) DO NOTHING`;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const a = adminOnly(request.headers.get('authorization'));
  if (a.error && !legacyAuth(request)) {
    return NextResponse.json({ error: a.error }, { status: a.status });
  }
  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
    const sql = neon(process.env.DATABASE_URL || '');
    await sql`DELETE FROM xx_link_blacklist WHERE id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
