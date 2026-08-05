// 2026-08-05: 接受求片 API
//   - POST /api/requests/[id]/claim
//   - 流程:
//     1) 查 request (status=open)
//     2) 不能求自己的片
//     3) UPDATE status='claimed' + claimed_by
//   - 完成求片: fulfilled_by 上传链接后, 走 /api/upload + admin 审核通过, 触发 /api/requests/[id]/fulfill

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
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

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  const id = parseInt(params.id);
  if (!id) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    const rows = await sql`SELECT id, user_id, status, lumen_cost FROM xx_requests WHERE id = ${id}`;
    if (rows.length === 0) {
      return NextResponse.json({ error: '找不到该求片' }, { status: 404 });
    }
    const r = rows[0];
    if (r.status !== 'open') {
      return NextResponse.json({ error: `该求片状态是 ${r.status}, 不能接单` }, { status: 400 });
    }
    if (r.user_id === user.id) {
      return NextResponse.json({ error: '不能接自己的求片' }, { status: 400 });
    }

    // 标记 claimed (claim 不奖励 lumen, 完成求片才奖励)
    await sql`UPDATE xx_requests SET status = 'claimed', fulfilled_by = ${user.id} WHERE id = ${id}`;

    return NextResponse.json({
      success: true,
      message: '✅ 已接单, 上传链接后 admin 审核通过即可完成求片',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
