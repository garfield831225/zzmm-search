// 2026-08-15: /api/point-logs/me - 当前用户的积分流水
//   业务规则:
//     - 任何登录 user 可用
//     - 查 xx_point_logs WHERE user_id = current
//     - 包含所有 type (upload_reward / checkin / redeem / admin_adjust 等)
//     - 按 created_at DESC 限 100 条

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

async function getUserId(request: NextRequest): Promise<number | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return Number(payload.id) || null;
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return Number(payload.id) || null;
    } catch {}
  }
  return null;
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 查所有 type (upload_reward / checkin / redeem / admin_adjust 等)
    // JOIN xx_pending_resources 拿关联的上传 name (upload_reward type)
    const rows = await sql`
      SELECT
        pl.id, pl.type, pl.amount, pl.ref_id, pl.note, pl.created_at,
        pr.name as upload_name, pr.type as upload_type
      FROM xx_point_logs pl
      LEFT JOIN xx_pending_resources pr ON pr.id = pl.ref_id
      WHERE pl.user_id = ${userId}
      ORDER BY pl.created_at DESC
      LIMIT 100
    ` as any[];

    return NextResponse.json({
      success: true,
      items: rows.map((r: any) => ({
        id: r.id,
        type: r.type,
        amount: r.amount,
        refId: r.ref_id,
        note: r.note,
        uploadName: r.upload_name,
        uploadType: r.upload_type,
        createdAt: r.created_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
