// /api/admin/games/match 鈥?鎶撴父鎴忓皝闈?(SGDB 浼樺厛, IGDB 鍏滃簳)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { requireAccess } from '@/lib/access';
import { searchSgdb, SgdbError } from '@/lib/sgdb';
import { searchIgdb, IgdbError } from '@/lib/igdb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel hobby 鏈€澶?60s, 涓€鎵?60s 鑳藉鐞嗙害 200 鏉?
// 鍏ㄩ噺闈犲墠绔疆璇? limit=200, 鍓嶇 batch 寰幆璋?273 娆?(54651/200)

function getSql() { return neon(process.env.DATABASE_URL!); }

// 娣峰悎绛栫暐: 鍏?SGDB (瑕嗙洊骞? 鑰佹父鎴忓己), 澶辫触鍐?IGDB (鐜颁唬娓告垙)
async function matchGame(name: string): Promise<{ source: 'sgdb'|'igdb'; cover: string; refId: string } | null> {
  // 1. SGDB 浼樺厛
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
      throw e; // key 閿? 涓嶅啀缁х画
    }
  }

  // 2. IGDB 鍏滃簳
  try {
    const igdb = await searchIgdb(name);
    if (igdb?.cover) {
      return { source: 'igdb', cover: igdb.cover, refId: 'igdb:' + igdb.id };
    }
  } catch {}

  return null;
}

export async function POST(req: NextRequest) {
  // 閴存潈
  const bypassToken = req.headers.get('x-admin-token');
  if (bypassToken && bypassToken === process.env.ADMIN_API_TOKEN && process.env.ADMIN_API_TOKEN) {
    // bypass OK
  } else {
    const auth = await requireAccess(req, 'vip');
    if (auth instanceof NextResponse) return auth;
    if (auth.effective_group !== 'admin') {
      return NextResponse.json({ error: '闇€瑕佺鐞嗗憳鏉冮檺' }, { status: 403 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const type: 'all' | 'pending' = body.type || 'pending';
  const platform: string | null = body.platform || null; // 闄愬畾骞冲彴
  const source: string | null = body.source || null; // cover_source 闄愬畾 (eg 'excel' = 鏈夊簳鍥惧緟鍗囩骇)
  const limit: number = Math.min(200, Math.max(1, parseInt(body.limit || '20')));

  let games: any[] = [];
  let total = 0;

  if (type === 'pending') {
    // 闈欐€?SQL 4 鍒嗘敮 (閬垮厤 neon tagged template 鍔ㄦ€佹嫾鎺?500)
    // 娉? 鍔?match_status='pending' 閬垮厤閲嶈窇宸插皾璇曡繃鐨?
    let list: any[], c: any[];
    if (platform && source) {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND platform = ${platform} AND cover_source = ${source} ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND platform = ${platform} AND cover_source = ${source}` as any[];
    } else if (platform) {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND platform = ${platform} AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND platform = ${platform} AND cover_url IS NULL` as any[];
    } else if (source) {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND cover_source = ${source} ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND match_status = 'pending' AND cover_source = ${source}` as any[];
    } else {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending' ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL AND match_status = 'pending'` as any[];
    }
    games = list;
    total = c[0]?.total || 0;
  } else {
    let list: any[], c: any[];
    if (platform) {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND platform = ${platform} AND cover_url IS NULL` as any[];
    } else {
      list = await getSql()`SELECT id, name, platform, cover_url, cover_source FROM xx_games WHERE status = 'active' AND cover_url IS NULL ORDER BY view_count DESC NULLS LAST, created_at DESC LIMIT ${limit}` as any[];
      c = await getSql()`SELECT COUNT(*)::int as total FROM xx_games WHERE status = 'active' AND cover_url IS NULL` as any[];
    }
    games = list;
    total = c[0]?.total || 0;
  }

  if (games.length === 0) {
    return NextResponse.json({ ok: true, total, processed: 0, message: '娌℃湁寰呭尮閰嶇殑娓告垙' });
  }

  const results: any[] = [];
  let matched = 0, failed = 0;
  const startTime = Date.now();

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    // 闂撮殧 180ms (鍗?API 280ms, 閿欏嘲, 100 鏉?~ 18s + API 鍝嶅簲 ~ 30s = 48s 鐣?buffer)
    await new Promise((r) => setTimeout(r, 180));
    try {
      const result = await matchGame(game.name);
      if (result) {
        await getSql()`
          UPDATE xx_games
          SET cover_url = ${result.cover}, rawg_slug = ${result.refId},
              cover_source = ${result.source},
              match_status = 'matched', match_attempted_at = NOW()
          WHERE id = ${game.id}
        `;
        matched++;
        results.push({ id: game.id, name: game.name, status: 'matched', cover: result.cover, source: result.source });
      } else {
        // 娌″尮閰? 淇濇寔 cover_url (excel 搴曞浘), 浣嗘敼鐘舵€佷负 failed (璁板綍灏濊瘯杩?
        await getSql()`
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
        results.push({ abort: 'key/auth/闄愭祦, 鏁存壒涓柇' });
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
      return NextResponse.json({ error: '闇€瑕佺鐞嗗憳鏉冮檺' }, { status: 403 });
    }
  }
  const stats = await getSql()`
    SELECT match_status, COUNT(*)::int as count
    FROM xx_games WHERE status='active'
    GROUP BY match_status
  ` as any[];
  return NextResponse.json({ ok: true, stats });
}
