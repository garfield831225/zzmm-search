// /api/games/platforms — 平台列表 + 每平台游戏数
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAccess } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAccess(req, 'vip');
  if (auth instanceof NextResponse) return auth;

  const rows = await sql`
    SELECT platform, COUNT(*)::int as count
    FROM xx_games
    WHERE status = 'active'
    GROUP BY platform
    ORDER BY count DESC
  `;

  return NextResponse.json({
    ok: true,
    platforms: rows,
  });
}
