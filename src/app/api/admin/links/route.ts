// 2026-07-17: Admin 改/删 资源链接 (xx_resource_links)
// PATCH 改 url/password/source
// DELETE 软删 (status='deleted'), 如果资源没链接了则软删资源
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authAdmin(req: NextRequest) {
  // 双轨鉴权: 优先 Authorization Bearer, 退到 cookie (zzmm_token / token)
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

// PATCH: 改 url/password/source
// body: { resourceId, source, url?, password?, newSource? }
export async function PATCH(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const body = await req.json().catch(() => ({}));
  const { resourceId, source, url, password, newSource } = body;
  if (!resourceId || !source) return NextResponse.json({ error: '需要 resourceId + source' }, { status: 400 });

  try {
    // 1. 先试副表
    let updated = false;
    if (newSource && newSource !== source) {
      const r = await sql`UPDATE xx_resource_links SET source = ${newSource} WHERE resource_id = ${resourceId} AND source = ${source} RETURNING id` as any[];
      if (r?.[0]?.id) updated = true;
    }
    if (!updated && url !== undefined) {
      const r = await sql`UPDATE xx_resource_links SET url = ${url} WHERE resource_id = ${resourceId} AND source = ${source} RETURNING id` as any[];
      if (r?.[0]?.id) updated = true;
    }
    if (!updated && password !== undefined) {
      const r = await sql`UPDATE xx_resource_links SET password = ${password} WHERE resource_id = ${resourceId} AND source = ${source} RETURNING id` as any[];
      if (r?.[0]?.id) updated = true;
    }

    // 2. 兜底: 副表没有 → 改主表老字段
    if (!updated) {
      if (url !== undefined) {
        await sql`UPDATE xx_resources SET link = ${url} WHERE id = ${resourceId} AND source = ${source}`;
      }
      if (password !== undefined) {
        await sql`UPDATE xx_resources SET link_code = ${password} WHERE id = ${resourceId} AND source = ${source}`;
      }
      if (newSource) {
        await sql`UPDATE xx_resources SET source = ${newSource} WHERE id = ${resourceId} AND source = ${source}`;
      }
    }
    return NextResponse.json({ ok: true, subTable: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

// DELETE: 软删链接; 检查资源是否还有 active 链接, 没则软删资源
// body: { resourceId, source }
// 业务规则 (2026-07-17): 兼容老字段 - 副表找不到时清空 xx_resources.link 兜底
export async function DELETE(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const body = await req.json().catch(() => ({}));
  const { resourceId, source } = body;
  if (!resourceId || !source) return NextResponse.json({ error: '需要 resourceId + source' }, { status: 400 });

  try {
    // 1. 软删副表链接
    const upd = await sql`UPDATE xx_resource_links SET status = 'deleted' WHERE resource_id = ${resourceId} AND source = ${source} RETURNING id` as any[];
    const subDeleted = upd && upd[0]?.id;

    // 2. 兜底: 副表没找到, 检查主表老字段并清空
    let mainCleared = false;
    if (!subDeleted) {
      const res = await sql`UPDATE xx_resources SET link = '', link_code = '', source = '' WHERE id = ${resourceId} AND source = ${source} AND link != '' RETURNING id` as any[];
      if (res && res[0]?.id) mainCleared = true;
    }

    if (!subDeleted && !mainCleared) {
      return NextResponse.json({ ok: false, error: '链接不存在' }, { status: 404 });
    }

    // 2b. 2026-07-18 修: 副表 sort=1 跟主表 link 一样的话, 删副表时同步清主表 link
    //   (因为 search 端点优先用副表 link, 但主表 link 是兜底, 不清的话 UI 还显示主表 link)
    //   业务规则: 用户删某个 source 时, 如果主表 source 跟被删的 source 一样 → 清主表 link
    if (subDeleted && !mainCleared) {
      const mainRes = await sql`SELECT link, source FROM xx_resources WHERE id = ${resourceId}`;
      if (mainRes[0]?.source === source && mainRes[0]?.link) {
        await sql`UPDATE xx_resources SET link = '', link_code = '' WHERE id = ${resourceId}`;
        mainCleared = true;
      }
    }

    // 3. 检查资源是否还有 active 链接 (副表 + 主表兜底)
    const subRemain = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = ${resourceId} AND status = 'active'`;
    const subCount = subRemain[0]?.cnt || 0;
    const mainRes = await sql`SELECT link, source FROM xx_resources WHERE id = ${resourceId}`;
    const mainHasLink = mainRes[0]?.link && mainRes[0]?.link !== '';
    const remainCount = subCount + (mainHasLink ? 1 : 0);
    let resourceDeleted = false;
    if (remainCount === 0) {
      await sql`UPDATE xx_resources SET status = 'deleted' WHERE id = ${resourceId}`;
      resourceDeleted = true;
    }
    return NextResponse.json({ ok: true, subDeleted: !!subDeleted, mainCleared, remain: remainCount, resourceDeleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
