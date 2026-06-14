// /api/admin/games/match — 抓 Rawg 封面 (通过 NAS 反代)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAccess } from '@/lib/access';
import { searchRawg, RawgProxyError } from '@/lib/rawg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest) {
  const auth = await requireAccess(req, 'vip');
  if (auth instanceof NextResponse) return auth;
  if (auth.effective_group !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const type: 'all' | 'pending' = body.type || 'pending';
  const limit: number = Math.min(100, Math.max(1, parseInt(body.limit || '20')));

  // 用 4 个静态 if, 不用动态拼接 tagged template (避免 500)
  let games: any[] = [];
  let total = 0;

  if (type === 'pending') {
    const list = await sql`
      SELECT id, name, platform FROM xx_games
      WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending'
      ORDER BY view_count DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    ` as any[];
    games = list;
    const c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending'` as any[];
    total = c[0]?.total || 0;
  } else {
    const list = await sql`
      SELECT id, name, platform FROM xx_games
      WHERE status = 'active' AND cover_url IS NULL
      ORDER BY view_count DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    ` as any[];
    games = list;
    const c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL` as any[];
    total = c[0]?.total || 0;
  }

  if (games.length === 0) {
    return NextResponse.json({ ok: true, total, processed: 0, message: '没有待匹配的游戏' });
  }

  const results: any[] = [];
  let matched = 0, failed = 0;
  const startTime = Date.now();

  for (const game of games) {
    await new Promise((r) => setTimeout(r, 1200));
    try {
      const result = await searchRawg(game.name);
      if (result?.cover) {
        await sql`
          UPDATE xx_games
          SET cover_url = ${result.cover}, rawg_slug = ${result.slug},
              match_status = 'matched', match_attempted_at = NOW()
          WHERE id = ${game.id}
        `;
        matched++;
        results.push({ id: game.id, name: game.name, status: 'matched', cover: result.cover });
      } else {
        await sql`
          UPDATE xx_games
          SET match_status = 'failed', match_attempted_at = NOW()
          WHERE id = ${game.id}
        `;
        failed++;
        results.push({ id: game.id, name: game.name, status: 'failed', reason: 'no result' });
      }
    } catch (e: any) {
      failed++;
      const reason = e instanceof RawgProxyError ? `NAS ${e.status}` : (e.message || '').slice(0, 100);
      results.push({ id: game.id, name: game.name, status: 'error', reason });
      if (e instanceof RawgProxyError && e.status >= 500) {
        results.push({ abort: 'NAS 反代 5xx, 整批中断' });
        break;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return NextResponse.json({
    ok: true,
    total,
    processed: games.length,
    matched,
    failed,
    elapsed: elapsed + 's',
    results: results.slice(0, 50),
  });
}

export async function GET(req: NextRequest) {
  const auth = await requireAccess(req, 'vip');
  if (auth instanceof NextResponse) return auth;
  if (auth.effective_group !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  const stats = await sql`
    SELECT match_status, COUNT(*)::int as count
    FROM xx_games WHERE status='active'
    GROUP BY match_status
  ` as any[];
  return NextResponse.json({ ok: true, stats });
}
