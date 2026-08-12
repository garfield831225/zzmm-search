// 2026-08-12: 公共 API - 单条 TMDB 匹配
//   - 跨服务调用 (moviezone / 未来其他子站)
//   - Bearer 鉴权 (admin/vip token 即可, 跟 /api/admin/match 一致)
//   - 不写 db / 不写 cache (调用方自己决定要不要持久化)
//   - 加 CORS 头 (moviezone.cc.cd 跟其他子站跨域调用)
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { matchOne, isGarbled, cleanFolderName } from '@/lib/match-engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30; // 单条匹配最慢 ~6s (3 strategies × 2 types × 2 keys), 给 5x buffer

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

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

  const { name, category, subType } = body;
  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return NextResponse.json({ error: 'name 必填, 至少 2 字符' }, { status: 400, headers: CORS_HEADERS });
  }

  const cat = category || '电影';
  const sub = subType || null;
  const cleaned = cleanFolderName(name);

  // GARBLED 直接返
  if (isGarbled(name)) {
    return NextResponse.json({
      status: 'GARBLED',
      cleaned,
      message: 'name 判定为乱码 (垃圾字符 >40%)',
    }, { headers: CORS_HEADERS });
  }

  try {
    const start = Date.now();
    const result = await matchOne(name, cat, sub);
    const ms = Date.now() - start;

    if (result === 'NOMATCH') {
      return NextResponse.json({
        status: 'NOMATCH',
        cleaned,
        duration_ms: ms,
      }, { headers: CORS_HEADERS });
    }

    return NextResponse.json({
      status: 'MATCHED',
      cleaned,
      duration_ms: ms,
      tmdb_id: (result as any).id,
      tmdb_type: (result as any).tmdb_type,
      title: (result as any).title,
      year: (result as any).year,
      vote_average: (result as any).vote,
      poster: (result as any).poster,
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 300) }, { status: 500, headers: CORS_HEADERS });
  }
}
