// /api/admin/games/[id] — 单个游戏修改/删除
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const id = parseInt(params.id);
  const body = await req.json().catch(() => ({}));

  const allowed = [
    'name', 'platform', 'sub_platform', 'cover_url', 'description',
    'link', 'link_code', 'size', 'source', 'release_date', 'publisher',
    'developer', 'language', 'is_vip_only', 'access_level', 'status',
    'rawg_id', 'rawg_slug', 'match_status'
  ];
  const sets: any[] = [];
  const values: any[] = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(sql`${k} = ${body[k]}`);
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: '没有可更新字段' }, { status: 400 });
  }

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`, sql``);
  const r = await sql`UPDATE xx_games SET ${setClause} WHERE id = ${id} RETURNING id` as any;
  if (!r || (Array.isArray(r) && r.length === 0)) {
    return NextResponse.json({ error: '游戏不存在' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const id = parseInt(params.id);
  // 软删除: status='deleted'
  const r = await sql`UPDATE xx_games SET status = 'deleted' WHERE id = ${id} RETURNING id` as any;
  if (!r || (Array.isArray(r) && r.length === 0)) {
    return NextResponse.json({ error: '游戏不存在' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, id, softDeleted: true });
}
