// 2026-08-13: 公共 API - 藏经阁/藏品区 (moviezone + 子站调用, AV 类)
//   GET /api/exclusive-zone?page=1&pageSize=30&sort=newest&filter=...
//   - Bearer admin/vip 鉴权
//   - 数据源: scraper-app (scraper.cc.cd) 的 Neon db → exclusive_zone 表
//   - 字段: title, category, image_url, magnet_link, code (per scraper-app AGENTS.md)
//   - **不动 scraper-app 源数据 / cron** (read-only)
//   - 跨 db read: 用 SCRAPER_DATABASE_URL env var (用户需配置)
//   - 错误格式: { error: { code, message, hint? } }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

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

  const scraperDbUrl = process.env.SCRAPER_DATABASE_URL;
  if (!scraperDbUrl) {
    return errJson(
      'scraper_db_not_configured',
      'SCRAPER_DATABASE_URL 环境变量未配置',
      '需在 zzmm-search 的 .env.production 加 SCRAPER_DATABASE_URL=postgresql://... (scraper-app 的 Neon 连接串), 然后重新部署',
      503
    );
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(60, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
  const sort = (searchParams.get('sort') || 'newest').toLowerCase();
  const filter = (searchParams.get('filter') || '').trim();
  const category = (searchParams.get('category') || '').trim();

  // 排序: newest (默认, 按 id DESC), oldest (id ASC)
  // filter: 模糊匹配 title / code
  // category: 精确匹配 category 字段
  const orderBy = sort === 'oldest' ? 'id ASC' : 'id DESC';

  try {
    const sql = neon(scraperDbUrl);

    // 1. count
    //    跨 db SQL: scraper-app 的 exclusive_zone 表, 用 neon() 走独立 connection
    //    filter 走 ILIKE 模糊匹配 title + code
    let countSQL: string;
    let countParams: any[] = [];
    if (filter) {
      countSQL = `SELECT COUNT(*)::int as cnt FROM exclusive_zone WHERE (title ILIKE $1 OR code ILIKE $1)`;
      countParams = [`%${filter}%`];
    } else {
      countSQL = `SELECT COUNT(*)::int as cnt FROM exclusive_zone`;
    }
    if (category) {
      countSQL += filter ? ` AND category = $${countParams.length + 1}` : ` WHERE category = $1`;
      countParams.push(category);
    }
    const countRows = await sql(countSQL, countParams) as any[];
    const total = countRows[0]?.cnt || 0;

    // 2. 列表
    //    orderBy 是固定字符串 (无用户数据), 内联安全
    //    limit / offset 用 ${} 注入 (数字已 Math.max/min 校验过)
    let listSQL: string;
    let listParams: any[] = [];
    const offset = (page - 1) * pageSize;
    if (filter) {
      listSQL = `SELECT id, title, category, image_url, magnet_link, code, created_at FROM exclusive_zone WHERE (title ILIKE $1 OR code ILIKE $1)`;
      listParams = [`%${filter}%`];
    } else {
      listSQL = `SELECT id, title, category, image_url, magnet_link, code, created_at FROM exclusive_zone`;
    }
    if (category) {
      listSQL += filter ? ` AND category = $${listParams.length + 1}` : ` WHERE category = $1`;
      listParams.push(category);
    }
    listSQL += ` ORDER BY ${orderBy} LIMIT $${listParams.length + 1} OFFSET $${listParams.length + 2}`;
    listParams.push(pageSize, offset);
    const rows = await sql(listSQL, listParams) as any[];

    return NextResponse.json({
      total,
      page,
      pageSize,
      sort,
      filter,
      category,
      hasMore: total > page * pageSize,
      items: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        imageUrl: r.image_url,
        magnetLink: r.magnet_link,
        code: r.code,
        createdAt: r.created_at,
      })),
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    console.error('[api/exclusive-zone] error:', e.message);
    return NextResponse.json(
      { error: { code: 'internal_error', message: e.message || '服务器错误' } },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
