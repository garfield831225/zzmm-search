// /api/internal/push-to-bridge
// zzmm-search 导入成功后, 把资源列表推给 import-bridge 服务
// import-bridge 再转 mov 真人
// 鉴权: Bearer INTERNAL_API_TOKEN (已有, 跨服务内部用)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || '';
const BRIDGE_URL = process.env.BRIDGE_URL || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// POST 手动触发: body: { batch_id? } 或 { resource_ids: [] }
// GET 查 import-bridge 状态
export async function GET(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!BRIDGE_URL) {
    return NextResponse.json({ error: 'BRIDGE_URL 未配置', code: 'bridge_not_configured' }, { status: 503 });
  }
  try {
    const r = await fetch(`${BRIDGE_URL}/status`, {
      headers: { 'X-Bridge-Token': BRIDGE_TOKEN },
      signal: AbortSignal.timeout(5000),
    });
    const j = await r.json();
    return NextResponse.json({
      ok: true,
      bridge_status: j,
      debug: {
        bridge_url: BRIDGE_URL,
        bridge_token_len: BRIDGE_TOKEN.length,
        bridge_token_prefix: BRIDGE_TOKEN.slice(0, 30),
        nas_status_code: r.status,
      }
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'bridge 不可达: ' + e.message }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const a = adminOnly(req.headers.get('authorization'));
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  if (!BRIDGE_URL || !BRIDGE_TOKEN) {
    return NextResponse.json({ error: 'BRIDGE_URL / BRIDGE_TOKEN 未配置' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const sql = neon(process.env.DATABASE_URL || '');

  // 取资源: 没指定 ID = 最近一批导入的; 指定 = 指定 ID 列表
  let items: any[];
  if (Array.isArray(body.resource_ids) && body.resource_ids.length) {
    const r = await sql`SELECT id, name, type, source, source_id, description, poster_url, tmdb_id, category, sub_type
                        FROM xx_resources WHERE id = ANY(${body.resource_ids})` as any[];
    items = r;
  } else if (body.since_minutes) {
    // 最近 N 分钟导入的
    const r = await sql`SELECT id, name, type, source, source_id, description, poster_url, tmdb_id, category, sub_type
                        FROM xx_resources
                        WHERE created_at > NOW() - (${body.since_minutes}::int * INTERVAL '1 minute')
                        ORDER BY id DESC LIMIT 500` as any[];
    items = r;
  } else {
    return NextResponse.json({ error: '请提供 resource_ids 或 since_minutes' }, { status: 400 });
  }

  if (!items.length) return NextResponse.json({ ok: true, count: 0, message: '没有资源可推' });

  // 取每个资源的链接
  const ids = items.map(i => i.id);
  const links = await sql`SELECT resource_id, url, password, size FROM xx_resource_links WHERE resource_id = ANY(${ids})` as any[];

  const itemsWithLinks = items.map(it => ({
    ...it,
    links: links.filter(l => l.resource_id === it.id),
  }));

  // 推 import-bridge
  try {
    const r = await fetch(`${BRIDGE_URL}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': BRIDGE_TOKEN,
      },
      body: JSON.stringify({
        items: itemsWithLinks,
        batch_id: body.batch_id || `zzmm-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json();
    return NextResponse.json({
      ok: j.ok,
      pushed: itemsWithLinks.length,
      bridge_resp: j,
    });
  } catch (e: any) {
    return NextResponse.json({ error: '推 bridge 失败: ' + e.message }, { status: 502 });
  }
}
