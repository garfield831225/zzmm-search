// /api/games — 游戏列表/详情/platforms
// 鉴权: vip 专属 (即 access_level='vip' 或 is_vip_only=true)
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAccess } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // 鉴权: 游戏是 vip 专属
  const auth = await requireAccess(req, 'vip');
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const platform = searchParams.get('platform') || '';
  const subPlatform = searchParams.get('sub_platform') || '';
  const keyword = (searchParams.get('q') || '').trim();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(60, Math.max(1, parseInt(searchParams.get('pageSize') || '24')));
  const sort = searchParams.get('sort') || 'created_at'; // created_at | view_count | name
  const order = searchParams.get('order') || 'desc';

  // 组装 WHERE
  const conditions: any[] = [sql`status = 'active'`];
  if (platform) conditions.push(sql`platform = ${platform}`);
  if (subPlatform) conditions.push(sql`sub_platform = ${subPlatform}`);
  if (keyword) conditions.push(sql`LOWER(name) LIKE ${'%' + keyword.toLowerCase() + '%'}`);

  // 安全 ORDER BY (白名单)
  const orderCol = ['created_at', 'view_count', 'name'].includes(sort) ? sort : 'created_at';
  const orderDir = order === 'asc' ? 'ASC' : 'DESC';

  // 拼 WHERE
  const whereClause = conditions.reduce((acc, c, i) => {
    return i === 0 ? c : sql`${acc} AND ${c}`;
  }, sql``);

  // 总数
  const countRows = await sql`
    SELECT COUNT(*)::int as total FROM xx_games WHERE ${whereClause}
  ` as any[];
  const total = countRows[0]?.total || 0;

  // 列表
  const offset = (page - 1) * pageSize;
  const rows = await sql`
    SELECT id, name, platform, sub_platform, cover_url, description,
           size, source, release_date, publisher, developer, language,
           tags, rawg_id, match_status, is_vip_only, view_count, created_at
    FROM xx_games
    WHERE ${whereClause}
    ORDER BY created_at DESC
    LIMIT ${pageSize} OFFSET ${offset}
  ` as any[];

  return NextResponse.json({
    ok: true,
    user: { id: auth.id, user_group: auth.effective_group, is_expired: auth.is_expired },
    total,
    page,
    pageSize,
    items: rows.map((r: any) => ({
      ...r,
      // 隐藏 link/link_code (列表不暴露)
      _has_link: true,
    })),
  });
}
