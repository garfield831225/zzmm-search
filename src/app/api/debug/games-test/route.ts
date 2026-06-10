// /api/debug/games-test — 一次性调试端, 测 /api/games 在 Vercel 上是否正常
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  let payload: any = null;
  if (auth?.startsWith('Bearer ')) {
    try { payload = jwt.verify(auth.slice(7), JWT_SECRET); } catch (e: any) { payload = { error: e.message }; }
  }

  const sql = neon(process.env.DATABASE_URL!);

  // 1. 用户是谁
  const me = auth?.startsWith('Bearer ') && payload?.id
    ? (await sql`SELECT id, username, user_group, expire_at FROM xx_users WHERE id=${payload.id}` as any[])
    : [];

  // 2. xx_games 总数
  const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_games WHERE status='active'` as any[];

  // 3. xx_games 平台分布
  const platforms = await sql`
    SELECT platform, COUNT(*)::int as count FROM xx_games
    WHERE status='active' GROUP BY platform ORDER BY count DESC LIMIT 5
  ` as any[];

  // 4. 直接用 sql 查 + 模拟 /api/games 行为 (不走 HTTP, 避免 self-fetch 问题)
  const sample = await sql`
    SELECT id, name, platform, sub_platform, cover_url, source, is_vip_only, access_level, match_status
    FROM xx_games WHERE status='active'
    ORDER BY created_at DESC LIMIT 3
  ` as any[];

  // 5. 模拟 requireAccess 鉴权
  const isAdmin = payload?.group === 'admin';
  const isVip = payload?.group === 'vip';
  const userRow = me[0];
  const isVipActive = userRow?.user_group === 'admin' ||
    (userRow?.user_group === 'vip' && (!userRow.expire_at || new Date(userRow.expire_at).getTime() > Date.now()));
  const accessResult = isAdmin || isVipActive
    ? { ok: true, sample: sample.length, items: sample.map(s => ({ id: s.id, name: s.name, platform: s.platform, cover: s.cover_url?.slice(0, 60) })) }
    : { ok: false, reason: !payload ? '未登录 (no token)' : (userRow?.user_group || 'unknown') + ' 不满足 vip' };

  return NextResponse.json({
    me: me[0] || null,
    payload: payload ? { id: payload.id, group: payload.group, exp: payload.exp } : null,
    gamesTotal: total[0]?.cnt,
    topPlatforms: platforms,
    accessResult,
  });

  return NextResponse.json({
    me: me[0] || null,
    payload: payload ? { id: payload.id, group: payload.group, exp: payload.exp } : null,
    gamesTotal: total[0]?.cnt,
    topPlatforms: platforms,
    accessResult,
  });
}
