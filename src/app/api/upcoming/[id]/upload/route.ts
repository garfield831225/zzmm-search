// 2026-08-03: P6.1 上传 API
//   - POST /api/upcoming/[id]/upload
//   - body: { type, links: [{url, source?}], size?, size_unit?, note? }
//   - admin: 直接 INSERT xx_resources (status=active, approved_by 自己)
//   - 普通用户: INSERT xx_pending_resources (status=pending, 等 admin 审核)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'cLWhs2015');

const VALID_TYPES = ['4K原盘', '原盘', 'REMUX', '4K', '杜比视界', '1080P', '720P', '低分辨率'];
const VALID_UNITS = ['GB', 'TB', 'MB'];

async function getUser(request: NextRequest): Promise<{ id: number; group: string; username: string } | null> {
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) {
    try {
      const { payload } = await jwtVerify(auth.slice(7), JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  const cookieToken = request.cookies.get('zzmm_token')?.value || request.cookies.get('token')?.value;
  if (cookieToken) {
    try {
      const { payload } = await jwtVerify(cookieToken, JWT_SECRET);
      return { id: Number(payload.id), group: String(payload.user_group || payload.group || ''), username: String(payload.username || '') };
    } catch {}
  }
  return null;
}

// 2026-08-03: 自动识别 4 大网盘 + 磁力
function detectSource(url: string): string {
  if (!url) return 'other';
  if (/magnet:\?xt=urn:btih:/i.test(url)) return 'magnet';
  if (/115\.com|115cdn\.com|anxia\.com/i.test(url)) return '115';
  if (/pan\.baidu\.com/i.test(url)) return 'baidu';
  if (/aliyundrive\.com|alipan\.com/i.test(url)) return 'aliyun';
  if (/pan\.quark\.cn/i.test(url)) return 'quark';
  if (/cloud\.189\.cn/i.test(url)) return '189cloud';
  if (/m\.bdurl\.net/i.test(url)) return 'baidu';
  if (/drive\.google\.com/i.test(url)) return 'google';
  return 'other';
}

// type 推断 category + access_level
function typeToCategory(type: string, isAdmin: boolean): { category: string; accessLevel: string } {
  if (type === '4K原盘' || type === '原盘' || type === 'REMUX') {
    return { category: type, accessLevel: isAdmin ? 'vip' : 'basic' };
  }
  if (type === '4K' || type === '杜比视界') {
    return { category: '电影', accessLevel: isAdmin ? 'vip' : 'basic' };
  }
  if (type === '1080P' || type === '720P' || type === '低分辨率') {
    return { category: '电影', accessLevel: 'basic' };
  }
  return { category: '电影', accessLevel: 'basic' };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const upcomingId = parseInt(params.id);
  if (!upcomingId) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '需要登录', status: 401 });
  }
  if (!user.username) {
    return NextResponse.json({ error: 'user.username 为空, 请重新登录' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { type, links, size, size_unit, note } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: 'type 不合法' }, { status: 400 });
    }
    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json({ error: 'links 至少 1 条' }, { status: 400 });
    }
    if (links.length > 10) {
      return NextResponse.json({ error: 'links 最多 10 条' }, { status: 400 });
    }
    // 校验每个 link
    for (const l of links) {
      if (typeof l !== 'string' || !l.trim()) {
        return NextResponse.json({ error: 'link 必须是字符串' }, { status: 400 });
      }
    }
    if (size !== undefined && size !== null) {
      const num = parseFloat(size);
      if (isNaN(num) || num <= 0) {
        return NextResponse.json({ error: 'size 必须是正数' }, { status: 400 });
      }
    }
    if (size_unit !== undefined && !VALID_UNITS.includes(size_unit)) {
      return NextResponse.json({ error: 'size_unit 必须是 GB/TB/MB' }, { status: 400 });
    }
    if (note && note.length > 50) {
      return NextResponse.json({ error: 'note 不能超过 50 字' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 查 TMDB 记录
    const tmdbRows = await sql`SELECT id, tmdb_id, tmdb_type, title FROM xx_upcoming WHERE id = ${upcomingId}`;
    if (tmdbRows.length === 0) {
      return NextResponse.json({ error: '找不到该 TMDB 记录' }, { status: 404 });
    }
    const tmdb = tmdbRows[0];

    const isAdmin = user.group === 'admin';
    const { category, accessLevel } = typeToCategory(type, isAdmin);

    // 第一条 link 决定 source
    const firstLink = links[0];
    const source = detectSource(firstLink);

    // name 格式: TMDB title + (类型)
    const name = `${tmdb.title} (${type})`;

    if (isAdmin) {
      // admin: 直接入库 xx_resources (status=active)
      const insertRows = await sql`
        INSERT INTO xx_resources (name, link, link_code, source, category, access_level, status, import_channel, tmdb_id, created_at, updated_at)
        VALUES (${name}, ${firstLink}, '', ${source}, ${category}, ${accessLevel}, 'active', 'user_upload', ${tmdb.tmdb_id}::text, NOW(), NOW())
        RETURNING id
      `;
      const newId = insertRows[0].id;
      return NextResponse.json({
        success: true,
        mode: 'direct',
        resourceId: newId,
        message: '✅ 管理员上传, 已直接入库',
      });
    } else {
      // 普通用户: 进 pending
      const insertRows = await sql`
        INSERT INTO xx_pending_resources (user_id, tmdb_id, name, type, links, size, size_unit, note, status, submitted_at)
        VALUES (${user.id}, ${tmdb.tmdb_id}::text, ${name}, ${type}, ${JSON.stringify(links)}::jsonb, ${size || null}, ${size_unit || 'GB'}, ${note || null}, 'pending', NOW())
        RETURNING id
      `;
      const newId = insertRows[0].id;
      return NextResponse.json({
        success: true,
        mode: 'pending',
        pendingId: newId,
        message: '⏳ 已提交审核, admin 通过后会入库',
      });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
