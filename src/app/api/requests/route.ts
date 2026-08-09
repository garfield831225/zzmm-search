// 2026-08-05: 求片专区 API
//   - GET  /api/requests  列表 (open / claimed by me / fulfilled by me)
//   - POST /api/requests  创建求片 (扣 lumen, status=open)
//   - DELETE /api/requests/[id]  取消我的求片 (status=cancelled, 退 lumen)
// 2026-08-06: GET 改用 Pool 模式 (neon() 子模板拼接 WHERE 被当 boolean column)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig, Pool } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

async function getUser(request: NextRequest): Promise<{ id: number; group: string; username: string } | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  return null;
}

export async function GET(request: NextRequest) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    // 2026-08-06: 改用 Pool.query(text, args) 拼动态 WHERE (neon() 子模板当 boolean column)
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const sp = request.nextUrl.searchParams;
    const status = sp.get('status') || 'all'; // 'open' | 'mine' | 'all'
    const page = parseInt(sp.get('page') || '1');
    const pageSize = Math.min(parseInt(sp.get('pageSize') || '30'), 100);

    const conds: string[] = ['1=1'];
    const args: any[] = [];
    if (status === 'open') {
      conds.push(`r.status = 'open'`);  // 2026-08-09: 加 r. 前缀 (LEFT JOIN xx_users 后 status 列歧义)
    } else if (status === 'mine') {
      args.push(user.id);
      conds.push(`user_id = $${args.length}`);
    }
    const whereSql = conds.join(' AND ');
    args.push(pageSize);
    const limitPos = `$${args.length}`;
    args.push((page - 1) * pageSize);
    const offsetPos = `$${args.length}`;

    const rowsRes = await pool.query(
      `SELECT r.id, r.user_id, r.tmdb_id, r.tmdb_type, r.title, r.reason, r.lumen_cost, r.status,
              r.fulfilled_by, r.fulfilled_resource_id, r.created_at, r.fulfilled_at,
              u.username as requester_username
       FROM xx_requests r
       LEFT JOIN xx_users u ON u.id = r.user_id
       WHERE ${whereSql}
       ORDER BY r.created_at DESC
       LIMIT ${limitPos} OFFSET ${offsetPos}`,
      args
    );
    const rows = rowsRes.rows;
    const totalRes = await pool.query(`SELECT count(*)::int as cnt FROM xx_requests r WHERE ${whereSql}`, args.slice(0, args.length - 2));
    const total = totalRes.rows[0]?.cnt || 0;

    return NextResponse.json({
      total,
      page,
      pageSize,
      status,
      items: rows.map((r: any) => ({
        id: r.id,
        userId: r.user_id,
        username: r.requester_username,
        tmdbId: r.tmdb_id,
        tmdbType: r.tmdb_type,
        title: r.title,
        reason: r.reason,
        lumenCost: r.lumen_cost,
        status: r.status,
        fulfilledBy: r.fulfilled_by,
        fulfilledResourceId: r.fulfilled_resource_id,
        createdAt: r.created_at,
        fulfilledAt: r.fulfilled_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 });
  }

  const { tmdb_id, tmdb_type, title, reason, lumen_cost } = body;
  if (!title || title.length > 200) {
    return NextResponse.json({ error: 'title 必填, 长度 < 200' }, { status: 400 });
  }
  if (reason && reason.length > 500) {
    return NextResponse.json({ error: 'reason 长度 < 500' }, { status: 400 });
  }
  const cost = parseInt(lumen_cost);
  if (!cost || cost < 1 || cost > 100) {
    return NextResponse.json({ error: 'lumen_cost 必须是 1-100' }, { status: 400 });
  }
  if (tmdb_id && !tmdb_type) {
    return NextResponse.json({ error: '有 tmdb_id 必须有 tmdb_type (movie|tv)' }, { status: 400 });
  }
  if (tmdb_type && !['movie', 'tv'].includes(tmdb_type)) {
    return NextResponse.json({ error: 'tmdb_type 必须是 movie|tv' }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 查用户流明余额
    const lumRows = await sql`SELECT balance FROM xx_user_lumen WHERE user_id = ${user.id}`;
    const balance = lumRows[0]?.balance ?? 0;
    if (balance < cost) {
      return NextResponse.json({ error: `流明不足, 当前 ${balance} 流明, 需要 ${cost} 流明` }, { status: 402 });
    }

    // 2) 扣流明 + 写流水
    const newBalance = balance - cost;
    await sql`UPDATE xx_user_lumen SET balance = ${newBalance}, updated_at = NOW() WHERE user_id = ${user.id}`;
    await sql`
      INSERT INTO xx_lumen_logs (user_id, type, change_amount, balance_after, ref_code, description, created_at)
      VALUES (${user.id}, 'request_create', ${-cost}, ${newBalance}, 'request', ${`求片: ${title}`}, NOW())
    `;

    // 3) 创建求片记录
    const ins = await sql`
      INSERT INTO xx_requests (user_id, tmdb_id, tmdb_type, title, reason, lumen_cost, status)
      VALUES (${user.id}, ${tmdb_id ? parseInt(tmdb_id) : null}, ${tmdb_type || null}, ${title}, ${reason || null}, ${cost}, 'open')
      RETURNING id
    `;

    return NextResponse.json({
      success: true,
      requestId: ins[0]?.id,
      lumenBalance: newBalance,
      message: `✅ 求片已发布, 扣除 ${cost} 流明, 剩余 ${newBalance} 流明`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
