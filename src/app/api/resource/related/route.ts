import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const resourceId = parseInt(params.id);
    if (isNaN(resourceId)) return NextResponse.json({ error: '无效ID' }, { status: 400 });

    const rows = await sql`SELECT tmdb_id, category FROM xx_resources WHERE id = ${resourceId} AND status = 'active'`;
    if (!rows.length) return NextResponse.json({ items: [] });

    const row = rows[0] as any;
    const tmdbId = row.tmdb_id;

    if (!tmdbId) return NextResponse.json({ items: [] });

    const related = await sql`
      SELECT id, name, link, link_code, source, category, size, valid_status
      FROM xx_resources
      WHERE tmdb_id = ${tmdbId} AND id != ${resourceId} AND status = 'active'
      ORDER BY valid_status = 'valid' DESC, created_at DESC
    `;

    const SOURCE_MAP: Record<string, string> = {
      '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
      'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
      'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
    };

    const items = (related as any[]).map((r: any) => ({
      id: r.id,
      name: r.name,
      link: r.link,
      link_code: r.link_code || '',
      source: SOURCE_MAP[r.source] || r.source,
      sourceKey: r.source,
      category: r.category,
      size: r.size,
      valid_status: r.valid_status,
    }));

    return NextResponse.json({ items });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}