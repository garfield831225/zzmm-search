import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const tab = searchParams.get('tab') || 'unmatched';
  const category = searchParams.get('category') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(50, parseInt(searchParams.get('pageSize') || '20'));
  const offset = (page - 1) * pageSize;

  try {
    if (tab === 'matched') {
      // 已匹配 = 有真实 tmdb_id（排除占位符 'NOMATCH' / 'GARBLED'）
      const rows = await sql`
        SELECT r.id, r.name, r.category, r.source, r.tmdb_id, c.title, c.poster_path, c.vote_average, c.release_date
        FROM xx_resources r
        LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
        WHERE r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND r.tmdb_id NOT IN ('NOMATCH', 'GARBLED')
        ${category ? sql`AND r.category = ${category}` : sql`AND 1=1`}
        ORDER BY r.updated_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      ` as any[];
      const cnt = await sql`
        SELECT COUNT(*)::int as cnt FROM xx_resources
        WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED')
        ${category ? sql`AND category = ${category}` : sql`AND 1=1`}
      `.catch(() => [{cnt:0}]) as any[];
      return NextResponse.json({ tab, items: rows, total: cnt[0]?.cnt, page, pageSize });
    } else {
      // 未匹配 = NULL / 空 / 'NOMATCH' / 'GARBLED'
      const rows = await sql`
        SELECT id, name, category, source, tmdb_id, created_at
        FROM xx_resources
        WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
          AND status = 'active'
        ${category ? sql`AND category = ${category}` : sql`AND 1=1`}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      ` as any[];
      const cnt = await sql`
        SELECT COUNT(*)::int as cnt FROM xx_resources
        WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
          AND status = 'active'
        ${category ? sql`AND category = ${category}` : sql`AND 1=1`}
      `.catch(() => [{cnt:0}]) as any[];
      return NextResponse.json({ tab, items: rows, total: cnt[0]?.cnt, page, pageSize });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const { id, action } = body;

  if (action === 'clear_all') {
    try {
      await sql`UPDATE xx_resources SET tmdb_id = NULL WHERE tmdb_id IS NOT NULL AND tmdb_id != ''`.catch(() => {});
      return NextResponse.json({ success: true });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  try {
    await sql`UPDATE xx_resources SET tmdb_id = NULL WHERE id = ${id}`.catch(() => {});
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const { id, tmdb_id, tmdb_type, title, poster_path, vote_average, release_date } = body;
  if (!id || !tmdb_id) return NextResponse.json({ error: 'missing id or tmdb_id' }, { status: 400 });

  // 拒绝占位符
  if (['NOMATCH', 'GARBLED', 'NULL', '0'].includes(String(tmdb_id))) {
    return NextResponse.json({ error: '无效的 tmdb_id' }, { status: 400 });
  }

  try {
    await sql`UPDATE xx_resources SET tmdb_id = ${tmdb_id}, updated_at = NOW() WHERE id = ${id}`.catch(() => {});
    if (tmdb_type) {
      await sql`
        INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, poster_path, vote_average, release_date, cached_at)
        VALUES (${tmdb_id}, ${tmdb_type}, ${title||''}, ${poster_path||''}, ${vote_average||0}, ${release_date||null}, NOW())
        ON CONFLICT (tmdb_id) DO UPDATE SET title = EXCLUDED.title, poster_path = EXCLUDED.poster_path, vote_average = EXCLUDED.vote_average, cached_at = NOW()
      `.catch(() => {});
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
