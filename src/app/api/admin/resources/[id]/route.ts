// 2026-07-20: Admin 软删整个资源 (含所有链接)
// DELETE /api/admin/resources/{id}
// - 软删资源 status='deleted'
// - 软删所有 active 副表链接 status='deleted'
// - 清主表 link/link_code/source 兜底
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authAdmin(req: NextRequest) {
  // 双轨鉴权: Bearer 优先, 退到 cookie
  let token: string | null = null;
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ') && auth.length > 7) {
    token = auth.slice(7);
  } else {
    token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || null;
  }
  if (!token) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015') as any;
    if (String(payload.user_group || payload.group || '').toLowerCase() !== 'admin') {
      return { error: '需要 admin', status: 403 };
    }
    return { userId: String(payload.id) };
  } catch {
    return { error: 'token 无效', status: 401 };
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const resourceId = parseInt(params.id);
  if (!resourceId || isNaN(resourceId)) return NextResponse.json({ error: 'resourceId 无效' }, { status: 400 });

  try {
    // 1. 看资源是否存在
    const exists = await sql`SELECT id, name, source, status FROM xx_resources WHERE id = ${resourceId}`;
    if (!exists[0]) return NextResponse.json({ error: '资源不存在', status: 404 });

    // 2. 软删所有 active 副表链接
    const subUpd = await sql`UPDATE xx_resource_links SET status = 'deleted' WHERE resource_id = ${resourceId} AND status = 'active' RETURNING id, source` as any[];
    const subLinks = subUpd?.length || 0;

    // 3. 清主表 link/link_code/source 兜底
    await sql`UPDATE xx_resources SET link = '', link_code = '', source = '' WHERE id = ${resourceId}`;

    // 4. 软删资源
    const mainUpd = await sql`UPDATE xx_resources SET status = 'deleted' WHERE id = ${resourceId} RETURNING id`;
    if (!mainUpd[0]) return NextResponse.json({ error: '资源软删失败' }, { status: 500 });

    return NextResponse.json({
      ok: true,
      resourceId,
      name: exists[0].name,
      subLinks,
      sources: subUpd?.map((x: any) => x.source) || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
