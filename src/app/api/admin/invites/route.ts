// /api/admin/invites - 邀请码生成 + 列表 + 删除 + 导出
// 2026-07-20: 改用共享 authAdmin (双轨鉴权 Bearer + cookie), 修 4 个用户管理卡打不开的 bug
// 2026-07-21: 改并发批量 INSERT (300/500 条不会超时) + 加导出端点 (?export=csv|txt)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

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

// GET 列表 + 导出
export async function GET(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const { searchParams } = new URL(req.url);
  const exportFmt = searchParams.get('export'); // 'csv' | 'txt' | null
  const filter = searchParams.get('filter') || 'all'; // 'all' | 'unused' | 'used' | 'expired'
  const idsParam = searchParams.get('ids'); // '1,2,3'
  const noteFilter = searchParams.get('note'); // 备注关键词

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 2026-07-21: 导出模式 — 全量拿 (LIMIT 10000), filter 在 JS 端做
    if (exportFmt === 'csv' || exportFmt === 'txt') {
      const allRows: any = await sql`
        SELECT id, code, note, created_at, expires_at, is_used
        FROM xx_invite_codes ORDER BY id DESC LIMIT 10000
      `;
      const ids = idsParam?.split(',').map(s => parseInt(s, 10)).filter(n => n > 0) || [];
      const filtered = applyFilter(allRows, { filter, ids, note: noteFilter || undefined });

      if (exportFmt === 'csv') {
        const lines = ['code,note,created_at,expires_at,is_used'];
        for (const r of filtered) {
          lines.push(`${r.code},"${(r.note || '').replace(/"/g, '""')}",${r.created_at || ''},${r.expires_at || ''},${r.is_used}`);
        }
        return new NextResponse(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="invite_codes_${filter}_${Date.now()}.csv"`,
          },
        });
      } else {
        return new NextResponse(filtered.map(r => r.code).join('\n'), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="invite_codes_${filter}_${Date.now()}.txt"`,
          },
        });
      }
    }

    // 普通列表 — LIMIT 500 (够用)
    const rows: any = await sql`
      SELECT id, code, note, created_at, created_by, used_by, expires_at, is_used,
        (SELECT username FROM xx_users WHERE id = xx_invite_codes.used_by) AS used_by_username
      FROM xx_invite_codes ORDER BY id DESC LIMIT 500
    `;
    const total = await sql`SELECT COUNT(*)::int AS c FROM xx_invite_codes`;
    const used = await sql`SELECT COUNT(*)::int AS c FROM xx_invite_codes WHERE is_used = true`;
    const expired = await sql`SELECT COUNT(*)::int AS c FROM xx_invite_codes WHERE is_used = false AND expires_at IS NOT NULL AND expires_at < NOW()`;
    return NextResponse.json({ items: rows, stats: { total: total[0].c, used: used[0].c, unused: total[0].c - used[0].c, expired: expired[0].c } });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function applyFilter(rows: any[], opts: { filter?: string; ids?: number[]; note?: string }) {
  let r = rows;
  if (opts.filter === 'unused') r = r.filter(x => !x.is_used);
  if (opts.filter === 'used') r = r.filter(x => x.is_used);
  if (opts.filter === 'expired') r = r.filter(x => !x.is_used && x.expires_at && new Date(x.expires_at) < new Date());
  if (opts.ids && opts.ids.length) r = r.filter(x => opts.ids!.includes(x.id));
  if (opts.note) r = r.filter(x => (x.note || '').toLowerCase().includes(opts.note!.toLowerCase()));
  return r;
}

// POST 生成 — 2026-07-21 改并发批量 INSERT
export async function POST(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const body = await req.json().catch(() => ({}));
  const count = Math.max(1, Math.min(1000, parseInt(String(body.count || 10), 10)));
  const note = String(body.note || '').slice(0, 200);
  const days = Math.max(1, Math.min(365, parseInt(String(body.expires_days || 30), 10)));

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 2026-07-21: JS 算 expires_at (Neon template tag 不会执行 SQL 表达式, 字符串会被当字面量)
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    const codes: string[] = [];
    const set = new Set<string>();
    // 去重: 1000 个 12 位字符碰撞概率极低, 但保险
    while (codes.length < count) {
      const c = genInviteCode();
      if (!set.has(c)) { set.add(c); codes.push(c); }
    }

    // 2026-07-21: 50 并发批量 INSERT, 避免 300/500 条逐条触发 Vercel 30s 超时
    // 1000 条 ÷ 50 = 20 批 × ~50ms = 1s 完成
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < codes.length; i += BATCH) {
      const slice = codes.slice(i, i + BATCH);
      await Promise.all(slice.map(code =>
        sql`INSERT INTO xx_invite_codes (code, note, created_by, expires_at, is_used)
            VALUES (${code}, ${note}, ${a.userId}, ${expiresAt}, false)`
          .then(() => { inserted++; })
          .catch((e: any) => {
            // 唯一约束冲突 (code 已存在) 跳过
            if (!String(e.message).includes('duplicate key') && !String(e.message).includes('unique')) throw e;
          })
      ));
    }
    return NextResponse.json({ codes, expires_days: days, inserted, requested: count });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// DELETE 删除 (清空未使用的) / 删除单个
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
    if (action === 'all_expired') {
      const r = await sql`DELETE FROM xx_invite_codes WHERE is_used = false AND expires_at IS NOT NULL AND expires_at < NOW()`;
      return NextResponse.json({ success: true, deleted: r.length });
    }
    if (!id) return NextResponse.json({ error: '需要 id 或 action=all_unused' }, { status: 400 });
    await sql`DELETE FROM xx_invite_codes WHERE id = ${id} AND is_used = false`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
