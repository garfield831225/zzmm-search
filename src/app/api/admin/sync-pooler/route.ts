// 2026-07-20: Admin 强制同步 Neon read replica
// POST /api/admin/sync-pooler
// 写一个无影响 UPDATE 触发主 endpoint 立即同步到 read replica
// 修 Vercel 函数 Neon pooler read replica lag (1-2 分钟甚至更久)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authAdmin(req: NextRequest) {
  let token: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && auth.length > 7) {
    token = auth.slice(7);
  } else {
    token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || null;
  }
  if (!token) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { userId: String(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 写一个无影响 UPDATE 触发主 endpoint 立即同步到 read replica
    //   只改 updated_at, 不改业务数据
    const start = Date.now();
    const r = await sql`UPDATE xx_resources SET updated_at = NOW() WHERE id = (SELECT MIN(id) FROM xx_resources WHERE id > 0) RETURNING id, updated_at`;
    const elapsed = Date.now() - start;
    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      trigger_row: r[0] || null,
      elapsed_ms: elapsed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
