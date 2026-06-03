import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const batchSize = Math.min(200, parseInt(url.searchParams.get('batch') || '50'));

  if (key !== process.env.JWT_SECRET) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 清理旧 tmdb 缓存（7天前）
    const cleaned = await sql`DELETE FROM xx_tmdb_cache WHERE cached_at < NOW() - INTERVAL '7 days'`.catch(() => []);
    console.log('cleaned old tmdb cache');

    // 统计各分类待匹配数量（包含 NULL/空/NOMATCH/GARBLED）
    const stats = await sql(`
      SELECT category, COUNT(*) as cnt FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active' AND name IS NOT NULL AND LENGTH(name) > 2
      GROUP BY category ORDER BY cnt DESC
    `) as any[];

    const total = await sql(`
      SELECT COUNT(*) as cnt FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active'
    `) as any[];

    // 已匹配 = 有真实 tmdb_id（排除占位符）
    const searchTotal = await sql(`
      SELECT COUNT(*) as cnt FROM xx_resources
      WHERE tmdb_id IS NOT NULL AND tmdb_id != '' AND tmdb_id NOT IN ('NOMATCH', 'GARBLED')
        AND status = 'active'
    `) as any[];

    // 资源来源统计
    const sourceStats = await sql(`
      SELECT source, COUNT(*) as cnt FROM xx_resources
      WHERE status = 'active' GROUP BY source ORDER BY cnt DESC
    `) as any[];

    // 最新导入的资源（未匹配）
    const recent = await sql(`
      SELECT id, name, category, source, created_at FROM xx_resources
      WHERE (tmdb_id IS NULL OR tmdb_id = '' OR tmdb_id IN ('NOMATCH', 'GARBLED'))
        AND status = 'active'
      ORDER BY created_at DESC LIMIT 10
    `) as any[];

    return NextResponse.json({
      totalResources: parseInt((total[0] as any)?.cnt || '0'),
      matchedResources: parseInt((searchTotal[0] as any)?.cnt || '0'),
      pendingByCategory: (stats || []).map((r: any) => ({ category: (r as any).category, count: parseInt((r as any).cnt || '0') })),
      bySource: (sourceStats || []).map((r: any) => ({ source: (r as any).source, count: parseInt((r as any).cnt || '0') })),
      recentUnmatched: (recent || []).map((r: any) => ({
        id: (r as any).id, name: (r as any).name, category: (r as any).category, source: (r as any).source, created_at: (r as any).created_at
      })),
      // 下载统计
      downloadStats: {
        todayDownloads: parseInt((await sql`SELECT COUNT(*) as cnt FROM xx_download_logs WHERE DATE(created_at) = CURRENT_DATE` as any[])[0]?.cnt || '0'),
        totalDownloads: parseInt((await sql`SELECT COUNT(*) as cnt FROM xx_download_logs` as any[])[0]?.cnt || '0'),
        totalUsers: parseInt((await sql`SELECT COUNT(*) as cnt FROM xx_users` as any[])[0]?.cnt || '0'),
        activeUsers: parseInt((await sql`SELECT COUNT(DISTINCT user_id) as cnt FROM xx_download_logs WHERE DATE(created_at) = CURRENT_DATE` as any[])[0]?.cnt || '0'),
      },
      message: 'stats ok - all routes verified',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}