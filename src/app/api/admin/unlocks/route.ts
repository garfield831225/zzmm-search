import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (!['admin'].includes(payload.group)) {
      return { error: '权限不足', status: 403 };
    }
    return { payload };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

export async function GET(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '50'));
  const userId = searchParams.get('user_id') || '';
  const resourceId = searchParams.get('resource_id') || '';
  const offset = (page - 1) * pageSize;

  const sql = neon(process.env.DATABASE_URL || '');

  const rows = await sql`
    SELECT u.id, u.user_id, u.resource_id, u.activation_code_id, u.unlocked_at,
           usr.username,
           r.name as resource_name, r.category as resource_category, r.code_price,
           ac.code, ac.price_at_issue
    FROM xx_user_unlocks u
    LEFT JOIN xx_users usr ON u.user_id = usr.id::text
    LEFT JOIN xx_resources r ON u.resource_id = r.id
    LEFT JOIN xx_activation_codes ac ON u.activation_code_id = ac.id
    WHERE 1=1
      ${userId ? sql`AND u.user_id = ${userId}` : sql`AND 1=1`}
      ${resourceId ? sql`AND u.resource_id = ${parseInt(resourceId)}` : sql`AND 1=1`}
    ORDER BY u.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const cnt = await sql`
    SELECT COUNT(*)::int as cnt FROM xx_user_unlocks
    WHERE 1=1
      ${userId ? sql`AND user_id = ${userId}` : sql`AND 1=1`}
      ${resourceId ? sql`AND resource_id = ${parseInt(resourceId)}` : sql`AND 1=1`}
  `;

  return NextResponse.json({
    items: rows,
    total: cnt[0]?.cnt,
    page,
    pageSize,
  });
}
