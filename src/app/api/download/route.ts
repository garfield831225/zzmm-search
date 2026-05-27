import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const DAILY_LIMITS: Record<string, number> = {
  free: 0, month: 100, season: 150, year: 200, lifetime: 300,
};
const GROUP_KEY: Record<string, string> = {
  free: 'free', month: 'month', season: 'season', year: 'year',
  lifetime: 'lifetime', vip: 'month', premium: 'year',
};
const RAPID_WINDOW_MS = 5000;
const RAPID_COUNT = 10;
const COOLDOWN_MINUTES = 10;
const DAILY_VIOLATION_LIMIT = 2;

function getGroupKey(g: string) { return GROUP_KEY[g] || 'free'; }
function getDailyLimit(g: string) { return DAILY_LIMITS[getGroupKey(g)] ?? 0; }

function parseToken(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.replace('Bearer ', '') : req.cookies.get('token')?.value;
  return token;
}

function decodeJwt(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    return { id: String(payload.id || payload.sub || ''), group: payload.group || 'free' };
  } catch {
    return null;
  }
}

function buildDownloadUrl(link: string, linkCode: string | null) {
  let url = link;
  if (linkCode) {
    const base = link.split('#')[0].split('?')[0];
    const sep = base.includes('?') ? '&' : '?';
    url = `${base}${sep}password=${linkCode}`;
  }
  return url;
}

// POST: bypasses rate limit, just returns the download URL (for frontend use)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const resourceId = body.resourceId || req.nextUrl.searchParams.get('id');
  const token = parseToken(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });
  if (!resourceId) return NextResponse.json({ error: '缺少资源ID' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');
  const [resource] = await sql`SELECT link, link_code FROM xx_resources WHERE id = ${parseInt(resourceId)} LIMIT 1` as any[];
  if (!resource) return NextResponse.json({ error: '资源不存在' }, { status: 404 });

  return NextResponse.json({ success: true, url: buildDownloadUrl(resource.link, resource.link_code) });
}

// GET: full rate limit + anti-bot tracking
export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get('id');
  if (!resourceId) return NextResponse.json({ error: '缺少资源ID' }, { status: 400 });

  const token = parseToken(req);
  if (!token) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const payload = decodeJwt(token);
  if (!payload) return NextResponse.json({ error: '登录已过期' }, { status: 401 });
  const { id: userId, group: userGroup } = payload;

  const today = new Date().toISOString().slice(0, 10);
  const now = Date.now();

  const [todayCount] = await sql`
    SELECT COUNT(*) as cnt FROM xx_download_logs
    WHERE user_id = ${userId} AND DATE(created_at) = ${today}
  ` as any[];
  const usedToday = parseInt(todayCount?.cnt || '0');

  const [block] = await sql`
    SELECT * FROM xx_user_blocks
    WHERE user_id = ${userId} AND block_type = 'cooldown' AND expire_at > NOW()
    LIMIT 1
  ` as any[];
  if (block) {
    const remaining = Math.ceil((new Date(block.expire_at).getTime() - now) / 60000);
    return NextResponse.json({ error: 'cooldown', message: `疑似机器人操作，请等待 ${remaining} 分钟`, cooldownMinutes: remaining }, { status: 429 });
  }

  const [resource] = await sql`
    SELECT id, name, link, link_code, source FROM xx_resources WHERE id = ${parseInt(resourceId)} LIMIT 1
  ` as any[];
  if (!resource) return NextResponse.json({ error: '资源不存在' }, { status: 404 });

  const limit = getDailyLimit(userGroup);
  if (limit === 0) return NextResponse.json({ error: 'no_permission', message: '免费用户无法使用下载功能，请升级会员' }, { status: 403 });
  if (usedToday >= limit) return NextResponse.json({ error: 'limit_reached', message: `今日次数已用完（${usedToday}/${limit}）`, usedToday, limit }, { status: 429 });

  const rapidThreshold = now - RAPID_WINDOW_MS;
  const [rapidCount] = await sql`
    SELECT COUNT(*) as cnt FROM xx_download_logs
    WHERE user_id = ${userId} AND created_at > TO_TIMESTAMP(${rapidThreshold / 1000})
  ` as any[];
  const rapidHits = parseInt(rapidCount?.cnt || '0');

  const [violations] = await sql`
    SELECT COUNT(*) as cnt FROM xx_user_blocks
    WHERE user_id = ${userId} AND block_type = 'cooldown' AND DATE(created_at) = ${today}
  ` as any[];
  const todayViolations = parseInt(violations?.cnt || '0');

  if (rapidHits >= RAPID_COUNT) {
    const violateCount = todayViolations + 1;
    if (violateCount >= DAILY_VIOLATION_LIMIT) {
      const blockUntil = new Date(today + 'T23:59:59Z');
      await sql`INSERT INTO xx_user_blocks (user_id, block_type, reason, expire_at) VALUES (${userId}, 'cooldown', '频繁机器人行为，今日已禁止', ${blockUntil})`;
      return NextResponse.json({ error: 'banned', message: '检测到异常行为，今日下载已禁止' }, { status: 429 });
    }
    const cooldownUntil = new Date(now + COOLDOWN_MINUTES * 60 * 1000);
    await sql`INSERT INTO xx_user_blocks (user_id, block_type, reason, expire_at) VALUES (${userId}, 'cooldown', '疑似机器人操作，触发冷却', ${cooldownUntil})`;
    return NextResponse.json({ error: 'cooldown', message: `疑似机器人操作，请等待 ${COOLDOWN_MINUTES} 分钟后重试`, cooldownMinutes: COOLDOWN_MINUTES, violationCount: violateCount }, { status: 429 });
  }

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
  await sql`INSERT INTO xx_download_logs (user_id, resource_id, resource_name, source, ip) VALUES (${userId}, ${resource.id}, ${resource.name}, ${resource.source}, ${ip})`;

  return NextResponse.json({ success: true, url: buildDownloadUrl(resource.link, resource.link_code), usedToday: usedToday + 1, limit });
}