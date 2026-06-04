// /api/user/unlocks/count - 返回用户已解锁资源数
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ count: 0, error: '未登录' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'cLWhs2015') as any;
    const userId = String(payload.id);
    const sql = neon(process.env.DATABASE_URL || '');
    const r = await sql`SELECT COUNT(*)::int as cnt FROM xx_user_unlocks WHERE user_id = ${userId}`;
    return NextResponse.json({ count: r[0]?.cnt || 0 });
  } catch (e: any) {
    return NextResponse.json({ count: 0, error: e.message }, { status: 500 });
  }
}
