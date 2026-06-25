import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function esc(s: string) { return String(s).replace(/'/g, "''"); }

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const payType = searchParams.get('pay_type') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
  const offset = (page - 1) * pageSize;

  try {
    const nameFilter = q ? `r.name ILIKE '%${esc(q)}%'` : '1=1';
    const payFilter = payType ? `r.pay_type = '${esc(payType)}'` : '1=1';

    const cnt = await sql(`SELECT COUNT(*) as cnt FROM xx_resources r WHERE r.status = 'active' AND ${nameFilter} AND ${payFilter}`) as any[];
    const total = parseInt(cnt?.[0]?.cnt || '0');

    const rows = await sql(`
      SELECT r.id, r.name, r.category, r.pay_type, r.code_price, r.tmdb_id, r.source,
             COALESCE(c.poster_path, '') as poster_path
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      WHERE r.status = 'active' AND ${nameFilter} AND ${payFilter}
      ORDER BY r.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `) as any[];

    return NextResponse.json({
      items: rows,
      total,
      page,
      pageSize,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const { id, pay_type, code_price } = body;

  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (pay_type && !['free', 'code'].includes(pay_type)) {
    return NextResponse.json({ error: 'pay_type must be "free" or "code"' }, { status: 400 });
  }
  const priceNum = code_price !== undefined ? Number(code_price) : null;
  if (priceNum !== null && (isNaN(priceNum) || priceNum < 0 || priceNum > 9999)) {
    return NextResponse.json({ error: 'code_price must be 0-9999' }, { status: 400 });
  }

  try {
    let updated: any = null;
    if (pay_type && priceNum !== null) {
      const r = await sql`UPDATE xx_resources SET pay_type = ${pay_type}, code_price = ${priceNum.toFixed(2)}, updated_at = NOW() WHERE id = ${id} RETURNING id, pay_type, code_price`;
      updated = r[0];
    } else if (pay_type) {
      const r = await sql`UPDATE xx_resources SET pay_type = ${pay_type}, updated_at = NOW() WHERE id = ${id} RETURNING id, pay_type, code_price`;
      updated = r[0];
    } else if (priceNum !== null) {
      const r = await sql`UPDATE xx_resources SET code_price = ${priceNum.toFixed(2)}, updated_at = NOW() WHERE id = ${id} RETURNING id, pay_type, code_price`;
      updated = r[0];
    }

    return NextResponse.json({ success: true, item: updated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // 批量：把所有 pay_type='code' 资源改回 'free'
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    await sql`UPDATE xx_resources SET pay_type = 'free', code_price = 0.00 WHERE pay_type = 'code'`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
