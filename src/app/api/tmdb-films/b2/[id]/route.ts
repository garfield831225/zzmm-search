import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.replace('Bearer ', '');
    const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT id, user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
    return r[0] ? { id: r[0].id, group: String(r[0].user_group || 'user').toLowerCase() } : null;
  } catch { return null; }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { id } = await params;
  const resourceId = parseInt(id, 10);
  if (!resourceId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const r = await sql`SELECT * FROM xx_resources WHERE id = ${resourceId} AND status = 'active' LIMIT 1` as any[];
  if (!r[0]) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const row = r[0];

  const user = await getUser(request);
  const userGroup = user?.group || 'user';
  const isVipPlus = ['vip', 'admin'].includes(userGroup);

  let canAccess = true;
  let lockReason: string | null = null;
  if (row.access_level === 'code' && row.code_price && Number(row.code_price) > 0) {
    canAccess = false; lockReason = 'code';
  } else if (row.access_level === 'vip' && !isVipPlus) {
    canAccess = false; lockReason = 'vip_required';
  } else if (row.import_channel === 'other' && !isVipPlus) {
    canAccess = false; lockReason = 'vip_required';
  }

  return NextResponse.json({
    resource: {
      id: row.id,
      name: row.name,
      link: row.link,
      link_code: row.link_code,
      source: row.source,
      category: row.category,
      size: row.size,
      type: row.type,
      tags: row.tags || [],
      view_count: Number(row.view_count || 0),
      pay_type: row.pay_type || 'free',
      code_price: row.code_price ? Number(row.code_price) : 0,
      access_level: row.access_level || 'basic',
      import_channel: row.import_channel || 'unknown',
      canAccess,
      lockReason,
    },
    user: { group: userGroup, isVipPlus, loggedIn: !!user },
  });
}
