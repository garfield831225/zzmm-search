// /api/internal/push-to-match-bridge
// 推送 zzmm-search 已匹配 TMDB 的资源到 mov 端 match-bridge
// 鉴权: Bearer INTERNAL_API_TOKEN (内部)
// 流程: SQL 取 tmdb_id IS NOT NULL 的资源 -> 分批 500 -> POST /api/match-bridge/import
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60; // Vercel hobby 60s, 单次最多处理 500 条

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || '';
const MATCH_BRIDGE_URL = process.env.MATCH_BRIDGE_URL || 'https://scraper.cc.cd/api/match-bridge';
const MATCH_BRIDGE_TOKEN = process.env.MATCH_BRIDGE_TOKEN || '';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

const VALID_CATEGORIES = new Set(['movie', 'tv', 'anime', 'doc', 'variety', 'concert', 'music', 'av']);

// POST 触发推送
// body: { batch_size?: number, force?: boolean, offset?: number }
// 默认 batch_size=500, 从 offset 0 开始
export async function POST(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  if (!MATCH_BRIDGE_TOKEN) {
    return NextResponse.json({ error: 'MATCH_BRIDGE_TOKEN 未配置', code: 'bridge_not_configured' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Number(body.batch_size) || 500, 500); // 上限 500
  const offset = Number(body.offset) || 0;
  const force = !!body.force;

  const sql = neon(process.env.DATABASE_URL || '');

  // 拿已匹配的资源 (tmdb_id 不为空)
  const r = await sql`
    SELECT id, name, category, tmdb_id
    FROM xx_resources
    WHERE tmdb_id IS NOT NULL AND tmdb_id > 0
    ORDER BY id
    LIMIT ${batchSize} OFFSET ${offset}
  ` as any[];

  if (!r.length) {
    return NextResponse.json({ ok: true, inserted: 0, skipped: 0, error_count: 0, message: '没有可推的资源', offset });
  }

  // 组装 match-bridge 期望的格式
  const matches = r.map((it: any) => ({
    name: it.name,
    category: VALID_CATEGORIES.has(it.category) ? it.category : 'movie',
    tmdb_id: it.tmdb_id,
    tmdb_type: it.category === 'tv' || it.category === 'anime' || it.category === 'variety' ? 'tv' : 'movie',
    raw: { xx_id: it.id },
  }));

  // 调 match-bridge import
  const url = force ? `${MATCH_BRIDGE_URL}/import?force=true` : `${MATCH_BRIDGE_URL}/import`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MATCH_BRIDGE_TOKEN}`,
    },
    body: JSON.stringify({ source: 'zzmm-search', matches }),
    signal: AbortSignal.timeout(55000),
  });
  const j = await resp.json().catch(() => ({}));

  return NextResponse.json({
    ok: j.ok,
    sent: r.length,
    offset,
    next_offset: offset + r.length,
    force,
    bridge_resp: j,
  });
}

// GET 查 match-bridge 状态
export async function GET(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  if (!MATCH_BRIDGE_URL || !MATCH_BRIDGE_TOKEN) {
    return NextResponse.json({ error: 'match-bridge env 未配置' }, { status: 503 });
  }

  try {
    const r = await fetch(`${MATCH_BRIDGE_URL}/health`, {
      headers: { 'Authorization': `Bearer ${MATCH_BRIDGE_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    return NextResponse.json({ ok: true, bridge_status: j });
  } catch (e: any) {
    return NextResponse.json({ error: 'match-bridge 不可达: ' + e.message }, { status: 502 });
  }
}
