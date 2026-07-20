// 2026-07-20: Admin 软删 / 硬删 整个资源
// DELETE /api/admin/resources/{id}[?hard=true]
// - 软删 (默认): status='deleted', 保留可恢复
// - 硬删 (?hard=true): 物理删除 xx_resources 行, 3 个外键 CASCADE 自动清理
//   - xx_resource_links.resource_id
//   - xx_link_feedback.resource_id
//   - xx_publish_log.resource_id
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

  // 2026-07-20: ?hard=true 走物理删除, 默认软删
  const hard = req.nextUrl.searchParams.get('hard') === 'true';

  try {
    // 1. 看资源是否存在
    const exists = await sql`SELECT id, name, source, status FROM xx_resources WHERE id = ${resourceId}`;
    if (!exists[0]) return NextResponse.json({ error: '资源不存在', status: 404 });

    if (hard) {
      // 硬删: 先数一下副表多少, 再物理删除主表 (CASCADE 自动清理)
      const subCount = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = ${resourceId}`;
      const feedbackCount = await sql`SELECT COUNT(*)::int as cnt FROM xx_link_feedback WHERE resource_id = ${resourceId}`;
      const publishCount = await sql`SELECT COUNT(*)::int as cnt FROM xx_publish_log WHERE resource_id = ${resourceId}`;

      const del = await sql`DELETE FROM xx_resources WHERE id = ${resourceId} RETURNING id`;
      if (!del[0]) return NextResponse.json({ error: '资源硬删失败' }, { status: 500 });

      return NextResponse.json({
        ok: true,
        hard: true,
        resourceId,
        name: exists[0].name,
        cascaded: {
          xx_resource_links: subCount[0]?.cnt || 0,
          xx_link_feedback: feedbackCount[0]?.cnt || 0,
          xx_publish_log: publishCount[0]?.cnt || 0,
        },
      });
    }

    // 软删: 默认路径
    // 2. 软删所有 active 副表链接
    const subUpd = await sql`UPDATE xx_resource_links SET status = 'deleted' WHERE resource_id = ${resourceId} AND status = 'active' RETURNING id, source` as any[];
    const subLinks = subUpd?.length || 0;

    // 3. 软删资源 (不再清空 link — 避免触发 xx_resources_link_name_unique 撞 link='')
    //   只改 status='deleted', 留 link/link_code/source 供恢复
    const mainUpd = await sql`UPDATE xx_resources SET status = 'deleted' WHERE id = ${resourceId} RETURNING id`;
    if (!mainUpd[0]) return NextResponse.json({ error: '资源软删失败' }, { status: 500 });

    return NextResponse.json({
      ok: true,
      hard: false,
      resourceId,
      name: exists[0].name,
      subLinks,
      sources: subUpd?.map((x: any) => x.source) || [],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
