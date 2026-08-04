// 2026-08-04: /api/admin/expire-vip-check
//   - admin 手动触发 (跟 cron 端点逻辑一样, 但走 admin 鉴权)
//   - 让 admin 在 dashboard 看到过期 VIP 列表 + 一键降级

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 列出过期 VIP (只读, 让 admin 看到)
    const expired = await sql`
      SELECT id, username, user_group, status, expire_at, last_login, created_at
      FROM xx_users
      WHERE user_group = 'vip'
        AND status = 'active'
        AND expire_at IS NOT NULL
        AND expire_at < NOW()
      ORDER BY expire_at DESC
      LIMIT 100
    `;

    // 2) 列出即将过期 (1 天内) 提示 admin
    const soonExpire = await sql`
      SELECT id, username, expire_at
      FROM xx_users
      WHERE user_group = 'vip'
        AND status = 'active'
        AND expire_at IS NOT NULL
        AND expire_at >= NOW()
        AND expire_at < NOW() + INTERVAL '1 day'
      ORDER BY expire_at ASC
      LIMIT 50
    `;

    return NextResponse.json({
      ok: true,
      expired,
      soonExpire,
      expiredCount: expired.length,
      soonExpireCount: soonExpire.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 找过期 VIP
    const expired = await sql`
      SELECT id, username, expire_at
      FROM xx_users
      WHERE user_group = 'vip'
        AND status = 'active'
        AND expire_at IS NOT NULL
        AND expire_at < NOW()
    `;

    if (expired.length === 0) {
      return NextResponse.json({ ok: true, message: '没有过期 VIP', count: 0 });
    }

    const ids = expired.map((u: any) => u.id);
    const upd = await sql`
      UPDATE xx_users
      SET user_group = 'basic'
      WHERE id = ANY(${ids}::int[])
      RETURNING id, username
    `;

    // 写流水
    for (const u of expired) {
      try {
        await sql`
          INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
          VALUES (${u.id}, 0, 0, 'expire', NULL, ${`VIP 过期降级 basic (expire_at=${u.expire_at?.toISOString?.() || u.expire_at})`}, NOW())
        `;
      } catch {}
    }

    return NextResponse.json({
      ok: true,
      message: `✅ 已降级 ${upd.length} 个过期 VIP → basic`,
      count: upd.length,
      users: upd,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
