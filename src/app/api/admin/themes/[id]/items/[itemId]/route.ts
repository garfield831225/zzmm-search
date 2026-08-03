// 2026-08-03: P5.3 admin 主题 item 单条操作
//   - DELETE /api/admin/themes/[id]/items/[itemId]   软删 (status='deleted')
//   - PUT    /api/admin/themes/[id]/items/[itemId]   改 sort_order

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const itemId = parseInt(params.itemId);
  if (!itemId) return NextResponse.json({ error: 'itemId 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '');
    await sql`UPDATE xx_theme_items SET status = 'deleted' WHERE id = ${itemId}`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const itemId = parseInt(params.itemId);
  if (!itemId) return NextResponse.json({ error: 'itemId 错误' }, { status: 400 });

  try {
    const body = await request.json();
    const { sort_order } = body;
    if (sort_order === undefined) {
      return NextResponse.json({ error: '缺少 sort_order' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    await sql`UPDATE xx_theme_items SET sort_order = ${sort_order} WHERE id = ${itemId}`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
