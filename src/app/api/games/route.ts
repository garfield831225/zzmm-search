// /api/games — 改用 Client (node-postgres wire protocol) 替代 neon()
// 鉴权: vip 专属
import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@neondatabase/serverless';
import { requireAccess } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 共享 client 缓存
let _client: Client | null = null;
async function getDb(): Promise<Client> {
  if (_client) return _client;
  _client = new Client({ connectionString: process.env.DATABASE_URL! });
  await _client.connect();
  return _client;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAccess(req, 'vip');
    if (auth instanceof NextResponse) return auth;

    const db = await getDb();
    const { searchParams } = new URL(req.url);
    const platform = searchParams.get('platform') || '';
    const keyword = (searchParams.get('q') || '').trim();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(60, Math.max(1, parseInt(searchParams.get('pageSize') || '24')));
    const offset = (page - 1) * pageSize;

    // Client.query 支持 $1, $2 参数化和任意 SQL 字符串
    const filterSql = platform || keyword
      ? `WHERE status = 'active' ${platform ? `AND platform = $1` : ''} ${keyword ? `${platform ? 'AND' : 'AND'} LOWER(name) LIKE $${platform ? 2 : 1}` : ''}`
      : `WHERE status = 'active'`;

    const params: any[] = [];
    if (platform) params.push(platform);
    if (keyword) params.push('%' + keyword.toLowerCase() + '%');

    const countRes = await db.query(
      `SELECT COUNT(*)::int as total FROM xx_games ${filterSql}`,
      params
    );
    const total = countRes.rows[0]?.total || 0;

    const listRes = await db.query(
      `SELECT id, name, platform, sub_platform, cover_url, description,
              size, source, release_date, publisher, developer, language,
              tags, rawg_id, match_status, is_vip_only, view_count, created_at
       FROM xx_games ${filterSql}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    return NextResponse.json({
      ok: true,
      user: { id: auth.id, user_group: auth.effective_group, is_expired: auth.is_expired },
      total,
      page,
      pageSize,
      items: listRes.rows.map((r: any) => ({ ...r, _has_link: true })),
    });
  } catch (e: any) {
    console.error('[api/games] FATAL:', e.message, e.stack);
    return NextResponse.json({ ok: false, error: '服务端错误', detail: e.message }, { status: 500 });
  }
}
