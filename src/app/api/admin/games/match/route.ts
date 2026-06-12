// /api/admin/games/match — 抓 Rawg 封面 (通过 NAS 反代)
// 用法: POST { type: 'all' | 'pending', limit: 20 }
// 后端: 每条 1.2s 间隔, 调 NAS 反代抓 rawg.io
import { NextRequest, NextResponse } from 'next/server';
import { Client } from '@neondatabase/serverless';
import { requireAdmin } from '@/lib/access';
import { searchRawg, RawgProxyError } from '@/lib/rawg';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

let _client: Client | null = null;
async function getDb(): Promise<Client> {
  if (_client) return _client;
  _client = new Client({ connectionString: process.env.DATABASE_URL! });
  await _client.connect();
  return _client;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const type: 'all' | 'pending' = body.type || 'pending';
  const limit: number = Math.min(100, Math.max(1, parseInt(body.limit || '20')));

  const db = await getDb();

  // 拉待匹配列表
  const whereClause = type === 'pending'
    ? `WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending'`
    : `WHERE status = 'active' AND cover_url IS NULL`;

  const rows = await db.query(
    `SELECT id, name, platform FROM xx_games ${whereClause} ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT $1`,
    [limit]
  );

  if (rows.rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const results: any[] = [];
  let matched = 0, failed = 0;
  const startTime = Date.now();

  for (const game of rows.rows) {
    // 1.2s 间隔防风控
    await new Promise((r) => setTimeout(r, 1200));

    try {
      const result = await searchRawg(game.name);
      if (result?.cover) {
        await db.query(
          `UPDATE xx_games SET cover_url = $1, rawg_slug = $2, match_status = 'matched', match_attempted_at = NOW() WHERE id = $3`,
          [result.cover, result.slug, game.id]
        );
        matched++;
        results.push({ id: game.id, name: game.name, status: 'matched', cover: result.cover });
      } else {
        await db.query(
          `UPDATE xx_games SET match_status = 'failed', match_attempted_at = NOW() WHERE id = $1`,
          [game.id]
        );
        failed++;
        results.push({ id: game.id, name: game.name, status: 'failed', reason: 'no result' });
      }
    } catch (e: any) {
      failed++;
      const reason = e instanceof RawgProxyError ? `NAS ${e.status}` : e.message?.slice(0, 100);
      results.push({ id: game.id, name: game.name, status: 'error', reason });
      // 一次错误, 整批中断 (NAS 可能挂了)
      if (e instanceof RawgProxyError && e.status >= 500) {
        results.push({ abort: 'NAS 反代 5xx, 整批中断' });
        break;
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  return NextResponse.json({
    ok: true,
    processed: rows.rows.length,
    matched,
    failed,
    elapsed: elapsed + 's',
    results: results.slice(0, 50), // 防止响应过大
  });
}

export async function GET(req: NextRequest) {
  const db = await getDb();
  const stats = await db.query(
    `SELECT match_status, COUNT(*)::int as count FROM xx_games WHERE status='active' GROUP BY match_status`
  );
  return NextResponse.json({ ok: true, stats: stats.rows });
}
