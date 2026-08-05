// API: /api/tmdb-resources/[type]/[id]
// 按 tmdb_id + type 查所有 xx_resources 链接（按 source 分组）
// 权限按 user_group 分级过滤
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { jwtVerify } from 'jose';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 30;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

async function getUserGroup(): Promise<string> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('zzmm_token')?.value || cookieStore.get('token')?.value;
    if (!token) return 'user';
    const payload = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET));
    return (payload.payload as any)?.group || 'user';
  } catch { return 'user'; }
}

const SOURCE_ORDER = ['115','baidu','quark','aliyun','xunlei','123pan','tianyi','uc','cmcc','pikpak','magnet','ed2k'];

export async function GET(req: Request, { params }: { params: { type: string; id: string } }) {
  const type = params.type;
  const tmdbId = params.id;
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const group = await getUserGroup();
    let rows: any[];

    // 固定 4 分支按 user_group 过滤 (不能用 sql.unsafe)
    // 2026-08-05: 移除 region 字段 (xx_resources 表不存在, 之前漏修导致 500)
    if (group === 'admin') {
      rows = await sql`
        SELECT id, name, link, link_code, source, size, lumen_cost,
               access_tier, access_level, import_channel, doc_sheet,
               sub_type, status, created_at, updated_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND type = ${type} AND status = 'active'
        ORDER BY source, created_at DESC
      ` as any[];
    } else if (group === 'vip') {
      rows = await sql`
        SELECT id, name, link, link_code, source, size, lumen_cost,
               access_tier, access_level, import_channel, doc_sheet,
               sub_type, status, created_at, updated_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND type = ${type} AND status = 'active'
          AND access_tier IN ('document', 'vip')
        ORDER BY source, created_at DESC
      ` as any[];
    } else if (group === 'basic' || group === 'member') {
      rows = await sql`
        SELECT id, name, link, link_code, source, size, lumen_cost,
               access_tier, access_level, import_channel, doc_sheet,
               sub_type, status, created_at, updated_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND type = ${type} AND status = 'active'
          AND access_tier = 'document'
        ORDER BY source, created_at DESC
      ` as any[];
    } else {
      // user (未激活): 只看 document + lumen_cost=0
      rows = await sql`
        SELECT id, name, link, link_code, source, size, lumen_cost,
               access_tier, access_level, import_channel, doc_sheet,
               sub_type, status, created_at, updated_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND type = ${type} AND status = 'active'
          AND access_tier = 'document'
          AND (lumen_cost IS NULL OR lumen_cost = 0)
        ORDER BY source, created_at DESC
      ` as any[];
    }

    if (!rows.length) {
      return NextResponse.json({ tmdb_id: tmdbId, type, user_group: group, total: 0, by_source: [] });
    }

    // 按 source 分组
    const bySourceMap = new Map<string, any[]>();
    for (const r of rows) {
      const src = r.source || 'unknown';
      if (!bySourceMap.has(src)) bySourceMap.set(src, []);
      bySourceMap.get(src)!.push(r);
    }

    const bySource = Array.from(bySourceMap.entries())
      .sort((a, b) => {
        const ai = SOURCE_ORDER.indexOf(a[0]);
        const bi = SOURCE_ORDER.indexOf(b[0]);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      })
      .map(([code, items]) => ({ source: code, count: items.length, items }));

    return NextResponse.json({
      tmdb_id: tmdbId,
      type,
      user_group: group,
      total: rows.length,
      by_source: bySource,
    });
  } catch (e: any) {
    console.error('[tmdb-resources error]', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}