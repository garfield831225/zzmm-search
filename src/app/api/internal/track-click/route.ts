// /api/internal/track-click - 内部 API
// middleware 异步 fire-and-forget 调用此端点, 记录用户每次 API click 到 xx_user_actions
// 鉴权: Authorization: Bearer <TRACK_CLICK_TOKEN> (从 .env.production 读, Edge Runtime middleware hardcode 副本)
// POST { user_id, path, ip }
// 返回: { ok }
// 2026-10-20: 全 API 点击计数 (心跳/refresh/search/unlock 全算), 防脚本挂机刷登录态
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

// TRACK_CLICK_TOKEN: middleware 不读 .env, hardcode 副本 + 与 .env.production 中的一致.
//   重新生成时必须同时更新两边 (用 set_internal_token.sh 脚本).
const TRACK_CLICK_TOKEN_HARDCODED = process.env.TRACK_CLICK_TOKEN || '';

// 路径白名单: 跳过静态/心跳/过大, 防止日志爆炸
// - _next/* 由 middleware matcher 排除, 不到这里
// - /api/auth/me 等是真正的活跃请求, 都该记
// 只跳过明显的探测/扫描路径
const SKIP_PREFIXES = [
  '/favicon', '/icon', '/logo', '/manifest',
  '/_next',
];

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some(p => path.startsWith(p));
}

export async function POST(req: NextRequest) {
  // 1. Bearer 鉴权
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized: missing Bearer' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!TRACK_CLICK_TOKEN_HARDCODED || token !== TRACK_CLICK_TOKEN_HARDCODED) {
    return NextResponse.json({ error: 'Unauthorized: bad token' }, { status: 403 });
  }

  // 2. 解析 body
  const body = await req.json().catch(() => ({}));
  const userId = Number(body?.user_id);
  const pathRaw = String(body?.path || '').slice(0, 255);
  const ipRaw = String(body?.ip || '').slice(0, 64);

  if (!userId || userId <= 0) {
    return NextResponse.json({ error: 'bad user_id' }, { status: 400 });
  }
  if (!pathRaw || shouldSkip(pathRaw)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // 3. INSERT xx_user_actions (失败不抛, 静默吞, 不影响主请求)
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    await sql`
      INSERT INTO xx_user_actions (user_id, action_type, ip, path)
      VALUES (${userId}, 'click', ${ipRaw || null}, ${pathRaw})
    `;
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // click 计数失败 = 不影响主业务, 静默记录
    console.error('[track-click] insert failed:', e?.message);
    return NextResponse.json({ ok: false, error: 'db_error' }, { status: 200 });
  }
}

// GET 仅做健康检查 (鉴权后返 ok)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!TRACK_CLICK_TOKEN_HARDCODED || token !== TRACK_CLICK_TOKEN_HARDCODED) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return NextResponse.json({ ok: true, message: 'track-click is healthy' });
}
