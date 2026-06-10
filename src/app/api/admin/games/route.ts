// /api/admin/games — admin 端游戏管理 (列表/创建/批量导入)
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 列表
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
  const platform = searchParams.get('platform') || '';
  const status = searchParams.get('status') || '';
  const matchStatus = searchParams.get('match_status') || '';

  const conditions: any[] = [sql`1=1`];
  if (platform) conditions.push(sql`platform = ${platform}`);
  if (status) conditions.push(sql`status = ${status}`);
  if (matchStatus) conditions.push(sql`match_status = ${matchStatus}`);

  const whereClause = conditions.reduce((acc, c, i) => i === 0 ? c : sql`${acc} AND ${c}`, sql``);

  const countRows = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE ${whereClause}` as any[];
  const total = countRows[0]?.total || 0;

  const offset = (page - 1) * pageSize;
  const rows = await sql`
    SELECT * FROM xx_games WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  ` as any[];

  return NextResponse.json({ ok: true, total, page, pageSize, items: rows });
}

// 批量创建
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];

  if (items.length === 0) {
    return NextResponse.json({ error: 'items 不能为空' }, { status: 400 });
  }

  const results: any[] = [];
  for (const it of items) {
    if (!it.name || !it.platform || !it.link) {
      results.push({ ok: false, name: it.name, error: '缺 name/platform/link' });
      continue;
    }
    try {
      const r = await sql`
        INSERT INTO xx_games (name, platform, sub_platform, cover_url, description, link, link_code, size, source, release_date, publisher, developer, language, is_vip_only, access_level, uploaded_by, match_status)
        VALUES (
          ${it.name}, ${it.platform}, ${it.sub_platform || null}, ${it.cover_url || null}, ${it.description || null},
          ${it.link}, ${it.link_code || null}, ${it.size || null}, ${it.source || null},
          ${it.release_date || null}, ${it.publisher || null}, ${it.developer || null}, ${it.language || null},
          ${it.is_vip_only !== false}, ${it.access_level || 'vip'}, ${auth.username}, 'pending'
        )
        RETURNING id
      ` as any[];
      results.push({ ok: true, id: r[0]?.id, name: it.name });
    } catch (e: any) {
      results.push({ ok: false, name: it.name, error: e.message });
    }
  }

  const success = results.filter((x) => x.ok).length;
  return NextResponse.json({ ok: true, total: items.length, success, results });
}
