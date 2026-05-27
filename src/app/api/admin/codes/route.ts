import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JWT_SECRET = process.env.JWT_SECRET || '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606';

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${seg()}-${seg()}-${seg()}`;
}

// 管理员生成激活码
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET) as any;

    // 简单权限检查
    if (!['admin'].includes(payload.group)) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const { count = 10, days = 30, batch = '默认批次' } = await req.json();
    const n = Math.min(100, Math.max(1, parseInt(count)));
    const d = Math.min(365, Math.max(1, parseInt(days)));

    const sql = neon(process.env.DATABASE_URL || '');

    const codes: string[] = [];
    for (let i = 0; i < n; i++) {
      const code = genCode();
      codes.push(code);
      await sql`
        INSERT INTO xx_activation_codes (code, days, batch_id, created_by, status, created_at)
        VALUES (${code}, ${d}, ${batch}, ${payload.id}, 'unused', NOW())
      `.catch(() => {});
    }

    return NextResponse.json({ generated: n, codes, days: d, batch });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// 查看激活码列表
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const token = authHeader.replace('Bearer ', '');
    const payload = jwt.verify(token, JWT_SECRET) as any;

    if (!['admin'].includes(payload.group)) {
      return NextResponse.json({ error: '权限不足' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '50'));

    const sql = neon(process.env.DATABASE_URL || '');
    const offset = (page - 1) * pageSize;

    const rows = await sql`
      SELECT ac.id, ac.code, ac.days, ac.batch_id, ac.status, ac.used_by, ac.used_at, ac.created_at,
             u.username as created_by_name
      FROM xx_activation_codes ac
      LEFT JOIN xx_users u ON ac.created_by = u.id
      ORDER BY ac.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const total = await sql`SELECT count(*) as cnt FROM xx_activation_codes` as any[];

    return NextResponse.json({
      items: rows,
      total: (total as any[])[0]?.cnt ?? 0,
      page,
      pageSize,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}