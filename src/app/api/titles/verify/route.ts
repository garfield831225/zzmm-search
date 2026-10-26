// /api/titles/verify - /titles 访问码校验 (服务端比对)
// 2026-10-22: 安全码存 xx_system_settings (key='titles_access_code'), 后台可改
//   - 不在前端硬编码 → 改码不用重新发版
//   - 输对 → 返回 ok, 前端种 titles_2015 cookie 后跳 /titles
//   - 限流: 同一 IP 5 分钟内最多 10 次尝试 (防暴力猜 4 位数字)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const SETTINGS_KEY = 'titles_access_code';
const DEFAULT_CODE = '2015';
const MAX_ATTEMPTS = 10;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

// 进程内尝试计数 (同一实例内生效, 够用)
const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }
  if (rec.count >= MAX_ATTEMPTS) {
    return { allowed: false, remaining: 0 };
  }
  rec.count++;
  return { allowed: true, remaining: MAX_ATTEMPTS - rec.count };
}

// 清理过期计数
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    attempts.forEach((v, k) => { if (v.resetAt < now) attempts.delete(k); });
  }, 60 * 1000).unref?.();
}

function getClientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    || req.headers.get('x-real-ip')
    || req.headers.get('cf-connecting-ip')
    || 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json({
        ok: false,
        error: '尝试次数过多, 请 5 分钟后再试',
      }, { status: 429 });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? '').trim();

    if (!/^\d{4}$/.test(code)) {
      return NextResponse.json({ ok: false, error: '请输入 4 位数字安全码' }, { status: 400 });
    }

    // 从 DB 读安全码 (读不到用默认值, 保证服务可用)
    let expected = DEFAULT_CODE;
    try {
      const sql = neon(process.env.DATABASE_URL || '');
      const rows = await sql`
        SELECT value FROM xx_system_settings WHERE key = ${SETTINGS_KEY} LIMIT 1
      ` as any[];
      if (rows[0]?.value) expected = String(rows[0].value).trim();
    } catch (e: any) {
      console.error('[titles/verify] settings read failed, use default:', e?.message);
    }

    if (code !== expected) {
      return NextResponse.json({ ok: false, error: '❌ 安全码错误, 请重新输入' }, { status: 401 });
    }

    // 校验成功: 清掉该 IP 的计数
    attempts.delete(ip);

    return NextResponse.json({ ok: true, remaining: rl.remaining });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || '验证失败' }, { status: 500 });
  }
}

// GET 拿当前配置 (给 /titles 页显示"安全码位数"等提示, 不返回真实码)
export async function GET() {
  return NextResponse.json({
    ok: true,
    required: true,
    length: 4,
    hint: '4 位数字安全码',
  });
}
