import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

import { recordClick } from '@/lib/track-click';  // 2026-10-20 异常用户登录: 全 API 点击计数
export const dynamic = 'force-dynamic';
// 2026-08-01: 加 fetchOptions no-store (修 memory #9 stale cache)
neonConfig.fetchConnectionCache = false;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    let token = '';
    if (auth?.startsWith('Bearer ')) token = auth.replace('Bearer ', '');
    else token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || '';
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const payload = jwt.verify(token, JWT_SECRET) as any;
    const userId = String(payload.id);      // 2026-10-20: 全 API 点击计数 (fire-and-forget)
      void recordClick(req, Number(payload.id));


    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });
    const rows = await sql`
      SELECT id, code, code_type, plan_id, duration, channel, batch_id, price_at_issue, used_at
      FROM xx_activation_codes
      WHERE used_by = ${userId}
      ORDER BY used_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ items: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
