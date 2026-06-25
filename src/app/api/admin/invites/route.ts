// /api/admin/invites - 邀请码生成 + 列表 + 删除
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 避易混字符
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randSeg(n: number): string {
  let r = '';
  for (let i = 0; i < n; i++) r += CHARS[Math.floor(Math.random() * CHARS.length)];
  return r;
}

function genInviteCode(): string {
  return 'INV-' + randSeg(4) + '-' + randSeg(4) + '-' + randSeg(4);
}

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// GET 列表
export async function GET(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      SELECT i.id, i.code, i.note, i.created_at, i.created_by, i.used_by, i.used_at, i.expires_at, i.is_used,
             u.username as used_by_username
      FROM xx_invite_codes i
      LEFT JOIN xx_users u ON i.used_by = u.id
      ORDER BY i.id DESC
      LIMIT 500
    ` as any[];

    // 统计
    const stats = await sql`
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE is_used)::int as used,
        COUNT(*) FILTER (WHERE NOT is_used)::int as unused,
        COUNT(*) FILTER (WHERE expires_at < NOW() AND NOT is_used)::int as expired
      FROM xx_invite_codes
    ` as any[];

    return NextResponse.json({ ok: true, items: rows, stats: stats[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST 生成
export async function POST(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const body = await req.json().catch(() => ({}));
  const count = Math.min(500, Math.max(1, parseInt(String(body.count ?? 1))));
  const note = String(body.note ?? '').slice(0, 200);
  const expiresDays = parseInt(String(body.expires_days ?? 30));

  const sql = neon(process.env.DATABASE_URL || '');
  const codes: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    let inserted = false;
    for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
      const code = genInviteCode();
      try {
        await sql`
          INSERT INTO xx_invite_codes (code, note, created_by, expires_at)
          VALUES (${code}, ${note || null}, ${String(a.payload.id)}, NOW() + (${expiresDays}::int * INTERVAL '1 day'))
        `;
        inserted = true;
        codes.push(code);
      } catch (e: any) {
        if (attempt === 7) errors.push(`${code}: ${e.message?.slice(0, 60)}`);
      }
    }
  }

  return NextResponse.json({
    generated: codes.length,
    codes,
    expires_days: expiresDays,
    note,
    errors: errors.length ? errors : undefined,
  });
}

// DELETE 删除 (清空未使用的)
export async function DELETE(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if ('error' in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      // 删除指定 (只能删未使用的)
      const r = await sql`DELETE FROM xx_invite_codes WHERE id = ${parseInt(id)} AND is_used = false`;
      return NextResponse.json({ ok: true, deleted: r.length ?? 0 });
    } else {
      // 批量清理已用过的
      const r = await sql`DELETE FROM xx_invite_codes WHERE is_used = true`;
      return NextResponse.json({ ok: true, deleted: r.length ?? 0, message: '已清理已用过的邀请码' });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}