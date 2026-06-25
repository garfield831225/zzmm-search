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
    const r = await sql`SELECT id, name, category, type, link, link_code, size, source, tmdb_id, sub_type, access_level
                        FROM xx_resources WHERE id = ANY(${body.resource_ids})` as any[];
    items = r;
  } else if (body.since_minutes) {
    // 最近 N 分钟导入的
    const r = await sql`SELECT id, name, category, type, link, link_code, size, source, tmdb_id, sub_type, access_level
                        FROM xx_resources
                        WHERE created_at > NOW() - (${body.since_minutes}::int * INTERVAL '1 minute')
                        ORDER BY id DESC LIMIT 500` as any[];
    items = r;
  } else {
    return NextResponse.json({ error: '请提供 resource_ids 或 since_minutes' }, { status: 400 });
  }

  if (!items.length) return NextResponse.json({ ok: true, count: 0, message: '没有资源可推' });

  // 把资源映射成 mov 真人要的 6 必填字段: user_id, account_id, name, category, type, files
  // category 中文 -> mov 8 值; type -> mov 4 值
  const catMap: Record<string, string> = {
    '电影': 'movie', '剧集': 'tv', '动漫': 'anime', '纪录片': 'doc',
    '综艺': 'variety', '演唱会': 'concert', '音乐': 'music',
    'REMUX': 'movie', '原盘': 'movie', '系列电影': 'movie', '合集': 'movie',
  };
  const typeMap: Record<string, string> = {
    'movie': 'movie', 'tv': 'tv', 'single': 'single', 'album': 'album',
  };

  const movItems = items.map(it => {
    const movCat = catMap[it.category] || 'movie';
    const movType = typeMap[it.type] || (movCat === 'tv' ? 'tv' : 'movie');
    const files = it.link ? [{
      url: it.link,
      password: it.link_code || '',
      size: it.size || '',
    }] : [];
    return {
      user_id: 'import_bridge',
      account_id: 9,
      name: it.name,
      category: movCat,
      type: movType,
      files,
      // 辅助字段
      source: it.source,
      tmdb_id: it.tmdb_id || null,
      sub_type: it.sub_type || null,
      access_level: it.access_level || 'basic',
      original_id: it.id,
    };
  });

  // 推 import-bridge
  try {
    const r = await fetch(`${BRIDGE_URL}/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': BRIDGE_TOKEN,
      },
      body: JSON.stringify({
        items: movItems,
        batch_id: body.batch_id || `zzmm-${Date.now()}`,
      }),
      signal: AbortSignal.timeout(25000),
    });
    const j = await r.json();
    return NextResponse.json({
      ok: j.ok,
      pushed: movItems.length,
      sample: movItems.slice(0, 2),
      bridge_resp: j,
    });
  } catch (e: any) {
    return NextResponse.json({ error: '推 bridge 失败: ' + e.message }, { status: 502 });
  }
}
