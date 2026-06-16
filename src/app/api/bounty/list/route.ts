// /api/bounty/list - 公开列表 (无需登录)
// ?status=pending|claimed|submitted|confirmed|cancelled
// ?mine=true (只看我发的/接的)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.replace('Bearer ', '') : '';
  if (!token) return null;
  try { return jwt.verify(token, JWT_SECRET) as any; } catch { return null; }
}

export async function GET(req: NextRequest) {
  const user = getUser(req);
  const sql = neon(process.env.DATABASE_URL || '');
  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const mine = req.nextUrl.searchParams.get('mine') === 'true';
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') || 30), 100);

  let r: any[];
  if (mine && user) {
    r = await sql`
      SELECT b.id, b.title, b.description, b.reward, b.creator_id, b.claimer_id, b.status, b.created_at,
             cu.username as creator_name, cl.username as claimer_name
      FROM xx_bounty b
      LEFT JOIN xx_users cu ON cu.id = b.creator_id
      LEFT JOIN xx_users cl ON cl.id = b.claimer_id
      WHERE (b.creator_id = ${user.id} OR b.claimer_id = ${user.id})
        AND b.status = ${status}
      ORDER BY b.created_at DESC LIMIT ${limit}
    ` as any[];
  } else {
    r = await sql`
      SELECT b.id, b.title, b.description, b.reward, b.creator_id, b.claimer_id, b.status, b.created_at,
             cu.username as creator_name
      FROM xx_bounty b
      LEFT JOIN xx_users cu ON cu.id = b.creator_id
      WHERE b.status = ${status}
      ORDER BY b.created_at DESC LIMIT ${limit}
    ` as any[];
  }

  return NextResponse.json({ ok: true, items: r, count: r.length, status });
}
