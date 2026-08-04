// 2026-08-04: /api/cron/expire-vip-check
//   - NAS systemd timer 每天调一次 (凌晨 4 点, 跟 prepull-tmdb 错开)
//   - CRON_SECRET 鉴权 (跟 prepull-tmdb 一样)
//   - 扫描 user_group='vip' AND expire_at < NOW() 的用户
//   - 改 user_group='basic' + 清 weekly_credit 计数 + 清 lumen 余额?
//   - 写日志到 xx_lumen_logs (type='expire')

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  // 1) CRON_SECRET 鉴权
  const url = new URL(request.url);
  const secret = url.searchParams.get('secret') || request.headers.get('x-cron-secret') || '';
  if (secret !== (process.env.CRON_SECRET || 'zzmm-cron-2026')) {
    return NextResponse.json({ error: 'secret 错误' }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 2) 找过期 VIP
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

    // 3) 批量降级到 basic
    // 2026-08-04 设计: 过期后
    //   - user_group: 'vip' → 'basic'
    //   - weekly_credit: 不清 (但 weekly_credit 表可能 row 不存在, 跳过)
    //   - lumen 余额: 不动 (用户花钱买的, 不能偷)
    //   - 解锁历史: 不动 (用户之前买的, 永久有效)
    //   - xx_lumen_logs: 写一条 type='expire' 流水标记
    const ids = expired.map((u: any) => u.id);

    const upd = await sql`
      UPDATE xx_users
      SET user_group = 'basic'
      WHERE id = ANY(${ids}::int[])
      RETURNING id, username
    `;

    // 4) 写流水 (用 lumen_logs 标记, type='expire')
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
