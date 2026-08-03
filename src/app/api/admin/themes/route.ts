// 2026-08-03: P5.2 admin 主题 CRUD
//   - GET    /api/admin/themes         列出所有主题 (含 inactive)
//   - POST   /api/admin/themes         创建主题
//   - PUT    /api/admin/themes         批量改 sort_order
//   单独的 /api/admin/themes/[id] 做改/删

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      SELECT t.id, t.name, t.slug, t.sort_order, t.status, t.created_at,
        (SELECT count(*) FROM xx_theme_items ti WHERE ti.theme_id = t.id AND ti.status = 'active') as item_count
      FROM xx_themes t
      ORDER BY t.sort_order ASC, t.id ASC
    `;
    return NextResponse.json({ success: true, themes: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  try {
    const body = await request.json();
    const { name, slug, sort_order } = body;
    if (!name || !slug) return NextResponse.json({ error: '缺少 name 或 slug' }, { status: 400 });
    // slug 格式校验
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return NextResponse.json({ error: 'slug 只能含小写字母/数字/连字符' }, { status: 400 });
    }
    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`
      INSERT INTO xx_themes (name, slug, sort_order, status, created_at)
      VALUES (${name}, ${slug}, ${sort_order || 100}, 'active', NOW())
      ON CONFLICT (slug) DO NOTHING
      RETURNING id, name, slug, sort_order, status, created_at
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: 'slug 已存在' }, { status: 400 });
    }
    return NextResponse.json({ success: true, theme: rows[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  try {
    const body = await request.json();
    const { orders } = body; // [{ id: 1, sort_order: 10 }, ...]
    if (!Array.isArray(orders)) return NextResponse.json({ error: 'orders 必须是数组' }, { status: 400 });
    const sql = neon(process.env.DATABASE_URL || '');
    for (const o of orders) {
      await sql`UPDATE xx_themes SET sort_order = ${o.sort_order} WHERE id = ${o.id}`;
    }
    return NextResponse.json({ success: true, updated: orders.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
