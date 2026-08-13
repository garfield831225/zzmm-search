// 2026-08-14: DEPRECATED - 公共 API exclusive-zone 已废弃
//   历史: 本来想让 zzmm-search 通过 SCRAPER_DATABASE_URL 跨 db 读 scraper-app 的 exclusive_zone 表
//   改: user Vercel dashboard 不会改 (Sensitive env 不能 decrypt), 拿不到连接串
//   决定: 这个端点返 410 Gone, 让 moviezone BFF 自己直连 scraper-app (read-only, 承诺不动源数据/cron)
//   未来: 如果 user 想要这个端点回来, 可以:
//     - 在 Vercel dashboard 把 SCRAPER_DATABASE_URL 改成 Encrypted (即可解密)
//     - 或者 scraper-app 加一个 /api/av/exclusive-zone-readonly (BFF 代理过去)
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function getAuth(req: NextRequest): { ok: true; group: string } | { ok: false; status: number; code: string; message: string } {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, status: 401, code: 'no_token', message: '缺少 Authorization Bearer token' };
  }
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
    const g = String(payload.user_group || payload.group || '').toLowerCase();
    if (g !== 'vip' && g !== 'admin') {
      return { ok: false, status: 403, code: 'forbidden', message: '需要 admin / vip token' };
    }
    return { ok: true, group: g };
  } catch {
    return { ok: false, status: 401, code: 'invalid_token', message: 'Token 无效或过期' };
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  // 鉴权仍然保留 (跟原设计一致)
  const auth = getAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: CORS_HEADERS }
    );
  }

  // 410 Gone: 永久废弃, 不返 503 (503 暗示"暂时不可用", 410 明确"换路径")
  return NextResponse.json({
    error: {
      code: 'endpoint_deprecated',
      message: '/api/exclusive-zone 已废弃, 请改走 moviezone BFF',
      hint: '数据源是 scraper-app (scraper.cc.cd) 的 exclusive_zone 表, 需要 scraper-app 的 DB 连接串 (用户拿不到, Vercel dashboard Sensitive env 不能解密). 改走 moviezone BFF 代理 (BFF 自连 scraper-app DB, 只读 exclusive_zone, 不动源数据/cron).',
      alternatives: {
        bff: 'moviezone.cc.cd/api/exclusive-zone (moviezone BFF 自管)',
        contact: '需要这个端点恢复? 在 Vercel dashboard 把 SCRAPER_DATABASE_URL 从 Sensitive 改成 Encrypted (解密), 我就能用 vercel env pull 拉真值恢复此端点',
      },
    },
  }, {
    status: 410,
    headers: {
      ...CORS_HEADERS,
      // 标准 410 头: 资源永久不可用
      'Deprecation': 'true',
      'Link': '<https://moviezone.cc.cd/api/exclusive-zone>; rel="successor-version"',
    },
  });
}
