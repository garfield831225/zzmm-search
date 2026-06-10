// /api/games/[id] — 游戏详情 (含下载链接)
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAccess } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAccess(req, 'vip');
  if (auth instanceof NextResponse) return auth;

  const id = parseInt(params.id);
  if (!id || isNaN(id)) {
    return NextResponse.json({ error: '无效的 ID' }, { status: 400 });
  }

  const rows = await sql`
    SELECT * FROM xx_games WHERE id = ${id} AND status = 'active'
  ` as any[];
  const game = rows[0];
  if (!game) {
    return NextResponse.json({ error: '游戏不存在或已下架' }, { status: 404 });
  }

  // 增加 view_count (fire and forget)
  sql`UPDATE xx_games SET view_count = view_count + 1 WHERE id = ${id}`.catch(() => {});

  return NextResponse.json({
    ok: true,
    user: { id: auth.id, user_group: auth.effective_group, is_expired: auth.is_expired },
    game,
  });
}
