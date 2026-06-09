import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function GET(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    let token = '';
    if (auth?.startsWith('Bearer ')) token = auth.replace('Bearer ', '');
    else token = req.cookies.get('zzmm_token')?.value || req.cookies.get('token')?.value || '';
    if (!token) return NextResponse.json({ error: '未登录' }, { status: 401 });

    const payload = jwt.verify(token, JWT_SECRET) as any;
    const userId = String(payload.id);

    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`
      SELECT id, code, code_type, plan_id, duration, channel, batch_id, price_at_issue, used_at
      FROM xx_activation_codes
      WHERE used_by = ${userId}
      ORDER BY used_at DESC
      LIMIT 100
    `;
    return NextResponse.json({ items: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
