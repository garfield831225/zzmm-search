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

    const isSeriesCategory = ['剧集', '动漫', '综艺'].includes(category);

    let related: any[];
    if (isSeriesCategory) {
      const allRelated = await sql`
        SELECT id, name, link, link_code, source, category, size, valid_status, created_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND id != ${resourceId} AND status = 'active'
        ORDER BY created_at DESC
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
        SELECT id, name, link, link_code, source, category, size, valid_status, created_at
        FROM xx_resources
        WHERE tmdb_id = ${tmdbId} AND id != ${resourceId} AND status = 'active'
        ORDER BY valid_status = 'valid' DESC, created_at DESC
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