// 2026-07-17: Admin 改/删 资源链接 (xx_resource_links)
// PATCH 改 url/password/source
// DELETE 软删 (status='deleted'), 如果资源没链接了则软删资源
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authAdmin(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
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
    // 如果是改 source, 先删旧 (UNIQUE constraint)
    if (newSource && newSource !== source) {
      await sql`UPDATE xx_resource_links SET source = ${newSource} WHERE resource_id = ${resourceId} AND source = ${source}`;
      if (url !== undefined) {
        await sql`UPDATE xx_resource_links SET url = ${url} WHERE resource_id = ${resourceId} AND source = ${newSource}`;
      }
      if (password !== undefined) {
        await sql`UPDATE xx_resource_links SET password = ${password} WHERE resource_id = ${resourceId} AND source = ${newSource}`;
      }
    } else {
      if (url !== undefined) {
        await sql`UPDATE xx_resource_links SET url = ${url} WHERE resource_id = ${resourceId} AND source = ${source}`;
      }
      if (password !== undefined) {
        await sql`UPDATE xx_resource_links SET password = ${password} WHERE resource_id = ${resourceId} AND source = ${source}`;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

// DELETE: 软删链接; 检查资源是否还有 active 链接, 没则软删资源
// body: { resourceId, source }
export async function DELETE(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sql = neon(process.env.DATABASE_URL || '');

  const body = await req.json().catch(() => ({}));
  const { resourceId, source } = body;
  if (!resourceId || !source) return NextResponse.json({ error: '需要 resourceId + source' }, { status: 400 });

  try {
    // 1. 软删链接
    await sql`UPDATE xx_resource_links SET status = 'deleted' WHERE resource_id = ${resourceId} AND source = ${source}`;

    // 2. 检查资源是否还有 active 链接
    const remain = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE resource_id = ${resourceId} AND status = 'active'`;
    const remainCount = remain[0]?.cnt || 0;
    let resourceDeleted = false;
    if (remainCount === 0) {
      // 3. 软删资源
      await sql`UPDATE xx_resources SET status = 'deleted' WHERE id = ${resourceId}`;
      resourceDeleted = true;
    }
    return NextResponse.json({ ok: true, remain: remainCount, resourceDeleted });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
