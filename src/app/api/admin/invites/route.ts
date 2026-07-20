// /api/admin/invites - 邀请码生成 + 列表 + 删除
// 2026-07-20: 改用共享 authAdmin (双轨鉴权 Bearer + cookie), 修 4 个用户管理卡打不开的 bug
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

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

// GET 列表
export async function GET(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`SELECT id, code, note, created_at, created_by, used_by, expires_at, is_used,
      (SELECT username FROM xx_users WHERE id = xx_invite_codes.used_by) AS used_by_username
      FROM xx_invite_codes ORDER BY id DESC LIMIT 500`;
    const total = await sql`SELECT COUNT(*)::int AS c FROM xx_invite_codes`;
    const used = await sql`SELECT COUNT(*)::int AS c FROM xx_invite_codes WHERE is_used = true`;
    return NextResponse.json({ items: rows, stats: { total: total[0].c, used: used[0].c } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST 生成
export async function POST(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const body = await req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(500, parseInt(String(body.count || 10), 10)));
  const note = String(body.note || '').slice(0, 200);
  const days = Math.max(1, Math.min(365, parseInt(String(body.expires_days || 30), 10)));

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const codes: string[] = [];
    // 2026-07-21: JS 算 expires_at (Neon template tag 不会执行 SQL 表达式, 字符串会被当字面量)
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    for (let i = 0; i < count; i++) codes.push(genInviteCode());
    for (const code of codes) {
      await sql`INSERT INTO xx_invite_codes (code, note, created_by, expires_at, is_used)
                VALUES (${code}, ${note}, ${a.userId}, ${expiresAt}, false)`;
    }
    return NextResponse.json({ codes, expires_days: days });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE 删除 (清空未使用的)
export async function DELETE(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const { searchParams } = new URL(req.url);
    const id = parseInt(searchParams.get('id') || '0', 10);
    const action = searchParams.get('action') || 'one';
    if (action === 'all_unused') {
      const r = await sql`DELETE FROM xx_invite_codes WHERE is_used = false`;
      return NextResponse.json({ success: true, deleted: r.length });
    }
    if (!id) return NextResponse.json({ error: '需要 id 或 action=all_unused' }, { status: 400 });
    await sql`DELETE FROM xx_invite_codes WHERE id = ${id} AND is_used = false`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
