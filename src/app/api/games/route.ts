// /api/games — 改用 Client (node-postgres wire protocol) 替代 neon()
//   2026-08-12 修: 放开 basic 看列表 (用户原话: basic 应该看到所有卡片, 点开 vip_only 游戏时前端加锁)
//   - admin / vip: 看全部 + 直接打开
//   - basic: 看全部, is_vip_only 的前端锁住
//   - user (未登录): 看全部
import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@neondatabase/serverless';

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
    // 2026-08-12 修: 去掉 requireAccess(req, 'vip'), 让 basic 也能看列表
    //   之前 basic 调这个 API 直接被 403 need='vip' 拒绝
    //   鉴权推到前端 (isGameVipLocked) + /api/games/[id] 路由内

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
