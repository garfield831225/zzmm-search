// /api/admin/games/match — 抓游戏封面 (SGDB 优先, IGDB 兜底)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAccess } from '@/lib/access';
import { searchSgdb, SgdbError } from '@/lib/sgdb';
import { searchIgdb, IgdbError } from '@/lib/igdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel hobby 最大 60s, 一批 60s 能处理约 200 条
// 全量靠前端轮询: limit=200, 前端 batch 循环调 273 次 (54651/200)

const sql = neon(process.env.DATABASE_URL!);

// 混合策略: 先 SGDB (覆盖广, 老游戏强), 失败再 IGDB (现代游戏)
async function matchGame(name: string): Promise<{ source: 'sgdb'|'igdb'; cover: string; refId: string } | null> {
  // 1. SGDB 优先
  try {
    const sgdb = await searchSgdb(name);
    if (sgdb?.coverVertical) {
      return { source: 'sgdb', cover: sgdb.coverVertical, refId: String(sgdb.id) };
    }
    if (sgdb?.cover) {
      return { source: 'sgdb', cover: sgdb.cover, refId: String(sgdb.id) };
    }
  } catch (e) {
    if (e instanceof SgdbError && e.status === 401) {
      throw e; // key 错, 不再继续
    }
  }

  // 2. IGDB 兜底
  try {
    const igdb = await searchIgdb(name);
    if (igdb?.cover) {
      return { source: 'igdb', cover: igdb.cover, refId: 'igdb:' + igdb.id };
    }
  } catch {}

  return null;
}

export async function POST(req: NextRequest) {
  // 鉴权
  const bypassToken = req.headers.get('x-admin-token');
  if (bypassToken && bypassToken === process.env.ADMIN_API_TOKEN && process.env.ADMIN_API_TOKEN) {
    // bypass OK
  } else {
    const auth = await requireAccess(req, 'vip');
    if (auth instanceof NextResponse) return auth;
    if (auth.effective_group !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const type: 'all' | 'pending' = body.type || 'pending';
  const platform: string | null = body.platform || null; // 限定平台
  const source: string | null = body.source || null; // cover_source 限定 (eg 'excel' = 有底图待升级)
  const limit: number = Math.min(200, Math.max(1, parseInt(body.limit || '20')));

  let games: any[] = [];
  let total = 0;

  if (type === 'pending') {
    // 静态 SQL 4 分支 (避免 neon tagged template 动态拼接 500)
    let list: any[], c: any[];
    if (platform && source) {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_source = ${source} ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_source = ${source}` as any[];
    } else if (platform) {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL` as any[];
    } else if (source) {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND cover_source = ${source} ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_source = ${source}` as any[];
    } else {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending' ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending'` as any[];
    }
    games = list;
    total = c[0]?.total || 0;
  } else {
    let list: any[], c: any[];
    if (platform) {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL` as any[];
    } else {
      list = await sql`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await sql`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL` as any[];
    }
    games = list;
    total = c[0]?.total || 0;
  }

  if (games.length === 0) {
    return NextResponse.json({ ok: true, total, processed: 0, message: '没有待匹配的游戏' });
  }

  const results: any[] = [];
  let matched = 0, failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    // 间隔 180ms (单 API 280ms, 错峰, 100 条 ~ 18s + API 响应 ~ 30s = 48s 留 buffer)
    await new Promise((r) => setTimeout(r, 180));
    try {
      // DEBUG: 第一个 game 输出 cleanName + env 状态
      if (i === 0) {
        // 直接调 SGDB autocomplete 看完整返回
        const tryR = await fetch('https://www.steamgriddb.com/api/v2/search/autocomplete/Pro%20Evolution%20Soccer%202019', {
          headers: { 'Authorization': 'Bearer ' + (process.env.SGDB_API_KEY || '') },
        });
        const tryJ = await tryR.json().catch(() => null);
        const all = (tryJ?.data || []).map((d: any) => d.name);
        const sgdbRaw = await searchSgdb(game.name).catch(e => ({ _err: e.message || String(e) }));
        results.push({ _debug: true, raw: game.name, sgdbAllResults: all, sgdbRaw });
      }
      const result = await matchGame(game.name);
      if (result) {
        await sql`
          UPDATE xx_games
          SET cover_url = ${result.cover}, rawg_slug = ${result.refId},
              cover_source = ${result.source},
              match_status = 'matched', match_attempted_at = NOW()
          WHERE id = ${game.id}
        `;
        matched++;
        results.push({ id: game.id, name: game.name, status: 'matched', cover: result.cover, source: result.source });
      } else {
        // 没匹配: 保持 cover_url (excel 底图), 但改状态为 failed (记录尝试过)
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
      let reason = '';
      if (e instanceof SgdbError) reason = `SGDB ${e.status}`;
      else if (e instanceof IgdbError) reason = `IGDB ${e.status}`;
      else reason = (e.message || '').slice(0, 100);
      results.push({ id: game.id, name: game.name, status: 'error', reason });
      if ((e instanceof SgdbError && e.status === 401) ||
          (e instanceof IgdbError && e.status === 429)) {
        results.push({ abort: 'key/auth/限流, 整批中断' });
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
  const bypassToken = req.headers.get('x-admin-token');
  if (!bypassToken || bypassToken !== process.env.ADMIN_API_TOKEN || !process.env.ADMIN_API_TOKEN) {
    const auth = await requireAccess(req, 'vip');
    if (auth instanceof NextResponse) return auth;
    if (auth.effective_group !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
    }
  }
  const stats = await sql`
    SELECT match_status, COUNT(*)::int as count
    FROM xx_games WHERE status='active'
    GROUP BY match_status
  ` as any[];
  return NextResponse.json({ ok: true, stats });
}
