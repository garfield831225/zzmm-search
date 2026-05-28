import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JWT_SECRET = process.env.JWT_SECRET || 'caoliangweizhendeshuang';

function verifyAdmin(token: string): any {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    if (!['admin'].includes(payload.group)) return null;
    return payload;
  } catch { return null; }
}

function checkKey(req: NextRequest) {
  const key = new URL(req.url).searchParams.get('key');
  return key === process.env.JWT_SECRET;
}

// GET /api/admin/users - 列表
export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const payload = token ? verifyAdmin(token) : null;

    // key 方式也允许（用于脚本调用）
    const isAdmin = payload || checkKey(req);
    if (!isAdmin) return NextResponse.json({ error: '权限不足' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '50'));
    const search = searchParams.get('search') || '';
    const offset = (page - 1) * pageSize;

    const sql = neon(process.env.DATABASE_URL || '');

    let rows: any[];
    let total: any;

    if (search) {
      rows = await sql`
        SELECT id, username, user_group, expire_at, status, created_at, last_login, is_verified
        FROM xx_users
        WHERE username ILIKE ${'%' + search + '%'}
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      total = await sql`SELECT count(*) as cnt FROM xx_users WHERE username ILIKE ${'%' + search + '%'}`;
    } else {
      rows = await sql`
        SELECT id, username, user_group, expire_at, status, created_at, last_login, is_verified
        FROM xx_users
        ORDER BY created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      total = await sql`SELECT count(*) as cnt FROM xx_users`;
    }

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

// POST /api/admin/users - 创建管理员账户
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const payload = token ? verifyAdmin(token) : null;
    const isAdmin = payload || checkKey(req);
    if (!isAdmin) return NextResponse.json({ error: '权限不足' }, { status: 403 });

    const { username, password } = await req.json();
    if (!username || !password || password.length < 6) {
      return NextResponse.json({ error: '用户名和密码必填，密码至少6位' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const exist = await sql`SELECT id FROM xx_users WHERE username = ${username}`;
    if ((exist as any[]).length > 0) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409 });
    }

    const hashed = bcrypt.hashSync(password, 10);
    const result = await sql`
      INSERT INTO xx_users (username, password_hash, user_group, expire_at, status, created_at, updated_at)
      VALUES (${username}, ${hashed}, 'admin', '2099-12-31', 'active', NOW(), NOW())
      RETURNING id, username, user_group
    `;

    return NextResponse.json({ success: true, user: (result as any[])[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PUT /api/admin/users - 更新用户
export async function PUT(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const payload = token ? verifyAdmin(token) : null;
    const isAdmin = payload || checkKey(req);
    if (!isAdmin) return NextResponse.json({ error: '权限不足' }, { status: 403 });

    const { id, action, ...data } = await req.json();
    if (!id) return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });

    const sql = neon(process.env.DATABASE_URL || '');

    if (action === 'toggle_status') {
      const newStatus = data.status === 'active' ? 'banned' : 'active';
      await sql`UPDATE xx_users SET status = ${newStatus}, updated_at = NOW() WHERE id = ${id}`;
      return NextResponse.json({ success: true });
    }

    if (action === 'extend') {
      const days = parseInt(data.days) || 30;
      const current = await sql`SELECT expire_at FROM xx_users WHERE id = ${id}` as any[];
      if (!current.length) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      const userRow = current[0] as any;

      let newExpire: Date;
      const now = new Date();
      if (userRow.expire_at && new Date(userRow.expire_at) > now) {
        newExpire = new Date(new Date(userRow.expire_at).getTime() + days * 86400000);
      } else {
        newExpire = new Date(now.getTime() + days * 86400000);
      }
      await sql`UPDATE xx_users SET expire_at = ${newExpire.toISOString()}, updated_at = NOW() WHERE id = ${id}`;
      return NextResponse.json({ success: true, new_expire: newExpire.toISOString().slice(0, 10) });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE /api/admin/users - 删除用户
export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    const payload = token ? verifyAdmin(token) : null;
    const isAdmin = payload || checkKey(req);
    if (!isAdmin) return NextResponse.json({ error: '权限不足' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get('id');
    const id = idParam ? parseInt(idParam) : 0;
    if (!id) return NextResponse.json({ error: '缺少用户ID' }, { status: 400 });

    const sql = neon(process.env.DATABASE_URL || '');
    await sql`DELETE FROM xx_users WHERE id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}