// /api/admin/games — admin 端游戏管理
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

export async function GET(req: NextRequest) {
  try {
    const auth = adminOnly(req.headers.get('authorization'));
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const platform = searchParams.get('platform') || '';
    const status = searchParams.get('status') || '';
    const matchStatus = searchParams.get('match_status') || '';

    const conds: string[] = ['1=1'];
    const params: any[] = [];
    if (platform) { conds.push(`platform = $${params.length + 1}`); params.push(platform); }
    if (status) { conds.push(`status = $${params.length + 1}`); params.push(status); }
    if (matchStatus) { conds.push(`match_status = $${params.length + 1}`); params.push(matchStatus); }
    const where = conds.join(' AND ');
    const offset = (page - 1) * pageSize;

    const sql = neon(process.env.DATABASE_URL || '');
    // 简化为: 不带过滤 (全列表) 或 status 过滤 (前 5 个)
    let rows: any[];
    if (status) {
      rows = await sql`SELECT id, name, platform, status, match_status, cover_url, cover_source, view_count, created_at FROM xx_games WHERE status = ${status} ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
    } else {
      rows = await sql`SELECT id, name, platform, status, match_status, cover_url, cover_source, view_count, created_at FROM xx_games ORDER BY id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
    }
    const total = await sql`SELECT COUNT(*) as cnt FROM xx_games` as any[];

    return NextResponse.json({
      ok: true,
      items: rows,
      total: Number(total[0]?.cnt || 0),
      page, pageSize,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
