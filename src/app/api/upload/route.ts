// 2026-08-05: 通用上传端点
//   - POST /api/upload { tmdb_id, tmdb_type, tmdb_title, type, links, size, size_unit, note }
//   - 流程:
//     1) 鉴权 (Bearer 或 cookie), 必须登录 (user/basic/vip/admin)
//     2) 查 xx_upcoming 是否存在, 不存在就 INSERT (TMDB 数据占位)
//     3) INSERT xx_pending_resources (status='pending', user_id, tmdb_id, type, links, ...)
//     4) admin 自己上传直接 status='approved' + 入库; user 上传待审核
//   - 全站通用: 详情页/卡片/列表都能调用

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

export async function POST(request: NextRequest) {
  const user = await getUser(request);
  if (!user) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体不是有效 JSON' }, { status: 400 });
  }

  const { tmdb_id, tmdb_type, tmdb_title, type, links, size, size_unit, note, poster_path, release_date } = body;
  if (!tmdb_id || !tmdb_type) {
    return NextResponse.json({ error: '缺少 tmdb_id 或 tmdb_type' }, { status: 400 });
  }
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type 必须是 ${VALID_TYPES.join('/')}` }, { status: 400 });
  }
  if (!Array.isArray(links) || links.length === 0 || links.length > 10) {
    return NextResponse.json({ error: 'links 必须是 1-10 个网盘链接数组' }, { status: 400 });
  }
  for (const l of links) {
    if (typeof l !== 'string' || l.trim().length === 0 || l.length > 1000) {
      return NextResponse.json({ error: '每个链接必须是非空字符串, 长度 < 1000' }, { status: 400 });
    }
  }
  if (size && (isNaN(parseFloat(size)) || parseFloat(size) <= 0)) {
    return NextResponse.json({ error: 'size 必须是正数' }, { status: 400 });
  }
  if (size_unit && !VALID_UNITS.includes(size_unit)) {
    return NextResponse.json({ error: `size_unit 必须是 ${VALID_UNITS.join('/')}` }, { status: 400 });
  }
  if (note && note.length > 50) {
    return NextResponse.json({ error: 'note 长度 < 50' }, { status: 400 });
  }

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 查 xx_upcoming 是否存在
    const upcomingRows = await sql`SELECT id FROM xx_upcoming WHERE tmdb_id = ${parseInt(tmdb_id)} AND tmdb_type = ${tmdb_type}`;
    if (upcomingRows.length === 0) {
      // 不存在就 INSERT 一个占位记录 (TMDB 数据不在, 但有用户上传)
      await sql`
        INSERT INTO xx_upcoming (tmdb_id, tmdb_type, title, status, fetched_at, poster_path, release_date)
        VALUES (${parseInt(tmdb_id)}, ${tmdb_type}, ${tmdb_title || '未知资源'}, 'active', NOW(), ${poster_path || null}, ${release_date || null})
        ON CONFLICT (tmdb_id, tmdb_type) DO NOTHING
      `;
    }

    // 2) INSERT xx_pending_resources
    const sizeNormalized = size ? parseFloat(size).toFixed(2) : null;
    const pendingRes = await sql`
      INSERT INTO xx_pending_resources (
        user_id, tmdb_id, name, type, links, size, size_unit, note, status, submitted_at
      )
      VALUES (
        ${user.id}, ${parseInt(tmdb_id)}, ${tmdb_title || '未知资源'},
        ${type}, ${JSON.stringify(links.map((l: string) => l.trim()))}::jsonb,
        ${sizeNormalized}, ${size_unit || 'GB'}, ${note || null},
        ${user.group === 'admin' ? 'approved' : 'pending'}, NOW()
      )
      RETURNING id, status
    `;

    return NextResponse.json({
      success: true,
      pendingId: pendingRes[0]?.id,
      status: pendingRes[0]?.status,
      message: user.group === 'admin'
        ? '✅ admin 上传, 已自动入库 (待审核 + 立即可见)'
        : '✅ 提交成功, 等待管理员审核',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
