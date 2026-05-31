import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const SOURCE_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const resourceId = parseInt(params.id);
    if (isNaN(resourceId)) return NextResponse.json({ error: '无效ID' }, { status: 400 });

    const rows = await sql`SELECT tmdb_id, category FROM xx_resources WHERE id = ${resourceId} AND status = 'active'`;
    if (!rows.length) return NextResponse.json({ items: [] });

    const row = rows[0] as any;
    const tmdbId = row.tmdb_id;
    const category = row.category;

    if (!tmdbId) return NextResponse.json({ items: [] });

    const isSeriesCategory = ['剧集', '动漫', '综艺', '连载'].includes(category);

    let related: any[];
    if (isSeriesCategory) {
      // 有 TMDB → 按 release_date 降序；无 TMDB → 按 created_at 降序
      const allRelated = await sql`
        SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.valid_status, r.created_at, r.tmdb_id,
               COALESCE(c.release_date, r.created_at::text) as sort_date
        FROM xx_resources r
        LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
        WHERE r.tmdb_id = ${tmdbId} AND r.id != ${resourceId} AND r.status = 'active'
        ORDER BY sort_date DESC
      ` as any[];

      if (allRelated.length > 3) {
        const currentIds = new Set(allRelated.slice(0, 3).map((r: any) => r.id));
        related = allRelated.map((r: any) => ({
          ...r,
          link_code: r.link_code || '',
          source: SOURCE_MAP[r.source] || r.source,
          sourceKey: r.source,
          size: r.size,
          isCurrent: currentIds.has(r.id),
        }));
      } else {
        related = allRelated.map((r: any) => ({
          ...r,
          link_code: r.link_code || '',
          source: SOURCE_MAP[r.source] || r.source,
          sourceKey: r.source,
          size: r.size,
          isCurrent: true,
        }));
      }
    } else {
      const allRelated = await sql`
        SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.valid_status, r.created_at, r.tmdb_id,
               COALESCE(c.release_date, r.created_at::text) as sort_date
        FROM xx_resources r
        LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
        WHERE r.tmdb_id = ${tmdbId} AND r.id != ${resourceId} AND r.status = 'active'
        ORDER BY sort_date DESC
      `;
      related = (allRelated as any[]).map((r: any) => ({
        ...r,
        link_code: r.link_code || '',
        source: SOURCE_MAP[r.source] || r.source,
        sourceKey: r.source,
        size: r.size,
        isCurrent: true,
      }));
    }

    return NextResponse.json({ items: related, tmdbType: isSeriesCategory ? 'tv' : 'movie' });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}