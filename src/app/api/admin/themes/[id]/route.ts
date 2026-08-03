// 2026-08-03: P5.2 admin 主题单条 CRUD
//   - PUT    /api/admin/themes/[id]   改 name / slug / sort_order / status
//   - DELETE /api/admin/themes/[id]   软删 (status='deleted') + 软删该主题下所有 items

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const id = parseInt(params.id);
  if (!id) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const body = await request.json();
    const { name, slug, sort_order, status } = body;
    const sql = neon(process.env.DATABASE_URL || '');

    // 动态 UPDATE (只更新提供的字段)
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (slug !== undefined) {
      if (!/^[a-z0-9-]+$/.test(slug)) return NextResponse.json({ error: 'slug 格式错' }, { status: 400 });
      updates.slug = slug;
    }
    if (sort_order !== undefined) updates.sort_order = sort_order;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '没东西要改' }, { status: 400 });
    }

    // 用 CASE 动态更新
    if (updates.name !== undefined && updates.slug !== undefined && updates.sort_order !== undefined) {
      await sql`UPDATE xx_themes SET name = ${updates.name}, slug = ${updates.slug}, sort_order = ${updates.sort_order} WHERE id = ${id}`;
    } else if (updates.name !== undefined && updates.sort_order !== undefined) {
      await sql`UPDATE xx_themes SET name = ${updates.name}, sort_order = ${updates.sort_order} WHERE id = ${id}`;
    } else if (updates.name !== undefined) {
      await sql`UPDATE xx_themes SET name = ${updates.name} WHERE id = ${id}`;
    } else if (updates.slug !== undefined && updates.sort_order !== undefined) {
      await sql`UPDATE xx_themes SET slug = ${updates.slug}, sort_order = ${updates.sort_order} WHERE id = ${id}`;
    } else if (updates.slug !== undefined) {
      await sql`UPDATE xx_themes SET slug = ${updates.slug} WHERE id = ${id}`;
    } else if (updates.sort_order !== undefined) {
      await sql`UPDATE xx_themes SET sort_order = ${updates.sort_order} WHERE id = ${id}`;
    } else if (updates.status !== undefined) {
      await sql`UPDATE xx_themes SET status = ${updates.status} WHERE id = ${id}`;
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const id = parseInt(params.id);
  if (!id) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '');
    // 软删主题
    await sql`UPDATE xx_themes SET status = 'deleted' WHERE id = ${id}`;
    // 软删该主题下所有 items
    await sql`UPDATE xx_theme_items SET status = 'deleted' WHERE theme_id = ${id}`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
