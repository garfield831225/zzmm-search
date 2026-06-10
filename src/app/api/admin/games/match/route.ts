// /api/admin/games/match — 抓 Rawg 封面 (后台异步任务)
// 用法: POST { type: 'all' | 'pending', limit: 10 }
// 后端: 每条 1.2s 间隔, 抓 rawg.io 网页 og:image
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 分钟

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchCover(name: string): Promise<{ cover: string | null; slug: string | null; rawg_id: number | null }> {
  try {
    // 1. 搜 rawg
    const searchUrl = `https://rawg.io/games?query=${encodeURIComponent(name)}`;
    const r = await fetch(searchUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { cover: null, slug: null, rawg_id: null };
    const html = await r.text();

    // 2. 解析第一条游戏链接
    const linkMatch = html.match(/href="(\/games\/[a-z0-9\-]+)"/);
    if (!linkMatch) return { cover: null, slug: null, rawg_id: null };

    const slug = linkMatch[1].replace('/games/', '');

    // 3. 找 og:image (列表页就有, 不跳详情页)
    const ogMatch = html.match(/og:image" content="([^"]+)"/);
    const cover = ogMatch?.[1] || null;

    return { cover, slug, rawg_id: null };
  } catch {
    return { cover: null, slug: null, rawg_id: null };
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const type: 'all' | 'pending' = body.type || 'pending';
  const limit: number = Math.min(100, Math.max(1, parseInt(body.limit || '20')));

  // 拉待匹配列表
  const where = type === 'pending'
    ? sql`status = 'active' AND match_status = 'pending'`
    : sql`status = 'active'`;

  const rows = await sql`
    SELECT id, name, platform FROM xx_games WHERE ${where}
    ORDER BY view_count DESC NULLS LAST, created_at DESC
    LIMIT ${limit}
  ` as any[];

  if (!rows || rows.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, results: [] });
  }

  const results: any[] = [];
  for (const game of rows) {
    // 1.2s 间隔防风控
    await new Promise((r) => setTimeout(r, 1200));

    const { cover, slug } = await fetchCover(game.name);

    if (cover) {
      await sql`
        UPDATE xx_games
        SET cover_url = ${cover}, rawg_slug = ${slug}, match_status = 'matched', match_attempted_at = NOW()
        WHERE id = ${game.id}
      `;
      results.push({ id: game.id, name: game.name, status: 'matched', cover });
    } else {
      await sql`
        UPDATE xx_games SET match_status = 'failed', match_attempted_at = NOW()
        WHERE id = ${game.id}
      `;
      results.push({ id: game.id, name: game.name, status: 'failed' });
    }
  }

  const matched = results.filter((r) => r.status === 'matched').length;
  return NextResponse.json({ ok: true, processed: rows.length, matched, results });
}

export async function GET(req: NextRequest) {
  // 查任务状态 (看哪些待匹配)
  const rows = await sql`
    SELECT match_status, COUNT(*)::int as count
    FROM xx_games WHERE status='active'
    GROUP BY match_status
  `;
  return NextResponse.json({ ok: true, stats: rows });
}
