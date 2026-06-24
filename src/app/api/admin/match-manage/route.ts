import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

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
  const auth = adminOnly(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') || 'unmatched';
  const category = searchParams.get('category') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(50, parseInt(searchParams.get('pageSize') || '20'));
  const offset = (page - 1) * pageSize;

  try {
    let rows: any[];
    let cnt: any[];

    if (tab === 'matched') {
      // 已匹配 = 纯数字 tmdb_id
      if (category) {
        rows = await sql`SELECT r.id, r.name, r.category, r.source, r.tmdb_id, c.title, c.poster_path, c.vote_average, c.release_date FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id NOT IN ('NOMATCH', 'GARBLED') AND r.category = ${category} ORDER BY r.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
        cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED') AND category = ${category}` as any[];
      } else {
        rows = await sql`SELECT r.id, r.name, r.category, r.source, r.tmdb_id, c.title, c.poster_path, c.vote_average, c.release_date FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id NOT IN ('NOMATCH', 'GARBLED') ORDER BY r.updated_at DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
        cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED')` as any[];
      }
      return NextResponse.json({ tab, items: rows, total: cnt[0]?.cnt, page, pageSize });
    } else {
      // 未匹配
      if (category) {
        rows = await sql`SELECT id, name, category, source, tmdb_id, created_at FROM xx_resources WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED')) AND status = 'active' AND category = ${category} ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
        cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED')) AND status = 'active' AND category = ${category}` as any[];
      } else {
        rows = await sql`SELECT id, name, category, source, tmdb_id, created_at FROM xx_resources WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED')) AND status = 'active' ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
        cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED')) AND status = 'active'` as any[];
      }
      return NextResponse.json({ tab, items: rows, total: cnt[0]?.cnt, page, pageSize });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const id = parseInt(searchParams.get('id') || '0');
  if (!id) return NextResponse.json({ error: '缺 id' }, { status: 400 });

  try {
    await sql`DELETE FROM xx_resources WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}