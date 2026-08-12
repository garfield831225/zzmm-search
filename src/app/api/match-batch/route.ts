// 2026-08-12: 公共 API - 批量 TMDB 匹配
//   - 跨服务调用 (moviezone 一次调一批)
//   - Bearer 鉴权 (admin/vip)
//   - max 50 条/批 (避免 Vercel 60s 超时, 50 条 × 6s 串行 = 300s 都不够)
//   - 实际: 5 并发 (跟 Neon RPS 5 限速匹配), 50 条 / 5 = 10 轮 × 6s = 60s
//   - 不写 db / 不写 cache
//   - 加 CORS 头
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { matchOne, isGarbled, cleanFolderName } from '@/lib/match-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // NAS 部署没 Vercel 60s 限制, 但给 60s 上限保护

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const MAX_BATCH = 50;
const CONCURRENCY = 5;  // 跟 Neon RPS 5/s 匹配

function getAuth(req: NextRequest): { ok: true; group: string } | { ok: false; error: string; status: number } {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { ok: false, error: '缺少 Authorization Bearer token', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    const group = String(payload.user_group || payload.group || 'user').toLowerCase();
    if (group !== 'vip' && group !== 'admin') {
      return { ok: false, error: '需要 admin / vip token', status: 403 };
    }
    return { ok: true, group };
  } catch {
    return { ok: false, error: 'Token 无效或过期', status: 401 };
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS_HEADERS });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body 必须是 JSON' }, { status: 400, headers: CORS_HEADERS });
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items 必填, 非空数组' }, { status: 400, headers: CORS_HEADERS });
  }
  if (items.length > MAX_BATCH) {
    return NextResponse.json({
      error: `items 最多 ${MAX_BATCH} 条/批, 实际 ${items.length} 条`,
      hint: '分批调, 每批 ≤ 50 条',
    }, { status: 400, headers: CORS_HEADERS });
  }

  const start = Date.now();
  const results: any[] = [];

  // 5 并发, 跟 Neon RPS 5 限速匹配
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map(async (item: any) => {
      const { name, category, subType } = item;
      if (!name || typeof name !== 'string' || name.trim().length < 2) {
        return { name, status: 'INVALID', error: 'name 必填, 至少 2 字符' };
      }
      const cat = category || '电影';
      const sub = subType || null;
      if (isGarbled(name)) {
        return { name, status: 'GARBLED', cleaned: cleanFolderName(name) };
      }
      try {
        const r = await matchOne(name, cat, sub);
        if (r === 'NOMATCH') {
          return { name, status: 'NOMATCH', cleaned: cleanFolderName(name) };
        }
        // GARBLED 已经在前面 isGarbled() 提前 return, 这里 narrow 是 match result
        const matched = r as { id: string; tmdb_type: 'movie' | 'tv'; poster: string; title: string; vote: number; year: string };
        return {
          name,
          status: 'MATCHED',
          cleaned: cleanFolderName(name),
          tmdb_id: matched.id,
          tmdb_type: matched.tmdb_type,
          title: matched.title,
          year: matched.year,
          vote_average: matched.vote,
          poster: matched.poster,
        };
      } catch (e: any) {
        return { name, status: 'ERROR', error: e.message?.slice(0, 200) };
      }
    }));
    results.push(...chunkResults);
  }

  // 统计
  const stats = {
    total: results.length,
    matched: results.filter(r => r.status === 'MATCHED').length,
    nomatch: results.filter(r => r.status === 'NOMATCH').length,
    garbled: results.filter(r => r.status === 'GARBLED').length,
    error: results.filter(r => r.status === 'ERROR').length,
    invalid: results.filter(r => r.status === 'INVALID').length,
    duration_ms: Date.now() - start,
  };

  return NextResponse.json({ stats, results }, { headers: CORS_HEADERS });
}
