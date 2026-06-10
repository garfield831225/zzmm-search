// /api/debug/games-test — 一次性调试端
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  const out: any = { steps: [] };
  try {
    // 1. 拿 token
    const auth = req.headers.get('authorization');
    out.steps.push({ step: '1. 读 header', hasAuth: !!auth, authStart: auth?.slice(0, 20) });

    let payload: any = null;
    if (auth?.startsWith('Bearer ')) {
      try {
        payload = jwt.verify(auth.slice(7), JWT_SECRET);
        out.steps.push({ step: '2. verify token', ok: true, payload: { id: payload.id, group: payload.group, exp: payload.exp } });
      } catch (e: any) {
        out.steps.push({ step: '2. verify token', ok: false, err: e.message });
      }
    } else {
      out.steps.push({ step: '2. verify token', ok: false, reason: 'no Bearer token' });
    }

    const sql = neon(process.env.DATABASE_URL!);

    // 3. 查 DB 用户
    const me = payload?.id
      ? (await sql`SELECT id, username, user_group, expire_at, status FROM xx_users WHERE id=${payload.id}` as any[])
      : [];
    out.steps.push({ step: '3. 查 xx_users', found: me.length, user: me[0] || null });

    // 4. xx_games 总数
    const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_games WHERE status='active'` as any[];
    out.steps.push({ step: '4. xx_games 总数', count: total[0]?.cnt });

    // 5. 鉴权判断
    const isAdmin = me[0]?.user_group === 'admin';
    const isVipActive = me[0]?.user_group === 'admin' ||
      (me[0]?.user_group === 'vip' && (!me[0]?.expire_at || new Date(me[0].expire_at).getTime() > Date.now()));
    out.steps.push({ step: '5. 鉴权判断', isAdmin, isVipActive, canAccess: isAdmin || isVipActive });

    if (isAdmin || isVipActive) {
      const sample = await sql`
        SELECT id, name, platform, sub_platform, cover_url, source, is_vip_only
        FROM xx_games WHERE status='active' ORDER BY created_at DESC LIMIT 3
      ` as any[];
      out.steps.push({ step: '6. 取 3 条样例', count: sample.length, sample: sample.map(s => ({ id: s.id, name: s.name, platform: s.platform, cover: s.cover_url?.slice(0, 50) })) });

      const platforms = await sql`
        SELECT platform, COUNT(*)::int as count FROM xx_games WHERE status='active' GROUP BY platform ORDER BY count DESC LIMIT 5
      ` as any[];
      out.steps.push({ step: '7. 平台分布 TOP 5', platforms });
    } else {
      out.steps.push({ step: '6. 鉴权失败, 不能取数据', reason: !payload ? 'no token' : `${me[0]?.user_group} 不满足 vip` });
    }
  } catch (e: any) {
    out.fatal = e.message;
    out.stack = e.stack?.split('\n').slice(0, 5);
  }
  return NextResponse.json(out, { status: 200 });
}
