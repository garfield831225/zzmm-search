// 2026-08-13: 公共 API - 非影视区 (moviezone + 子站调用)
//   GET /api/nonfilm?cat=音乐&page=1&pageSize=30&userGroup=basic
//   - Bearer admin/vip 鉴权
//   - userGroup query: 4 档 (跟 detail 一样, basic + vip 看所有, user 返 0)
//   - 薄包装 /api/search?zone=nonfilm&category=cat (复用现有大 SQL)
//   - 简化返回: 跟 search 一样, 但去掉 groups/categories/sources (公共 API 简化)
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const VALID_GROUPS = new Set(['user', 'basic', 'member', 'vip', 'admin']);
const NONFILM_CATS = new Set(['音乐', '体育', '游戏', '电子书', '精品课', '文档']);

function errJson(code: string, message: string, hint?: string, status = 400) {
  return NextResponse.json(
    { error: { code, message, ...(hint ? { hint } : {}) } },
    { status, headers: CORS_HEADERS }
  );
}

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
  const auth = getAuth(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: { code: auth.code, message: auth.message } },
      { status: auth.status, headers: CORS_HEADERS }
    );
  }

  const { searchParams } = new URL(req.url);
  const cat = searchParams.get('cat') || '全部';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(60, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
  const userGroup = (searchParams.get('userGroup') || 'user').toLowerCase();
  const q = (searchParams.get('q') || '').trim();
  // 2026-08-14: 短剧打标转发 - 业务规则: 短剧是打标不是分类, nonfilm 虽不主要
  //   但保持跟 search 一致, BFF 透传 tag query
  const tag = (searchParams.get('tag') || '').trim();

  if (cat !== '全部' && !NONFILM_CATS.has(cat)) {
    return errJson('invalid_cat', `cat 必须是 全部/音乐/体育/游戏/电子书/精品课/文档 之一`, `实际: ${cat}`, 400);
  }
  if (!VALID_GROUPS.has(userGroup)) {
    return errJson('invalid_user_group', `userGroup 必须是 user/basic/vip/admin 之一`, `实际: ${userGroup}`, 400);
  }

  // 构造 search URL (内部调用, server-to-server, 同主机)
  // 注意: 不能用绝对 URL (会触发公网代理), 用相对路径
  const searchUrl = new URL('/api/search', `http://127.0.0.1:3004`);
  searchUrl.searchParams.set('zone', 'nonfilm');
  searchUrl.searchParams.set('category', cat);
  searchUrl.searchParams.set('page', String(page));
  searchUrl.searchParams.set('pageSize', String(pageSize));
  if (q) searchUrl.searchParams.set('q', q);
  if (tag) searchUrl.searchParams.set('tag', tag);

  try {
    const r = await fetch(searchUrl, {
      headers: {
        // 透传 Bearer (search 会从 cookie 拿, 但有 Bearer 也认)
        'Authorization': req.headers.get('authorization') || '',
        'Cookie': req.headers.get('cookie') || '',
      },
      cache: 'no-store',
    });
    if (!r.ok) {
      return errJson('upstream_error', `search upstream 返 ${r.status}`, undefined, 502);
    }
    const data = await r.json();

    // 简化返回: 只保留 items/total/hasMore/userGroup/cat
    return NextResponse.json({
      total: data.total || 0,
      page,
      pageSize,
      cat,
      userGroup,
      hasMore: data.total > page * pageSize,
      items: data.items || [],
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    console.error('[api/nonfilm] error:', e.message);
    return NextResponse.json(
      { error: { code: 'internal_error', message: e.message || '服务器错误' } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
