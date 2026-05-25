import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const resourcesRes = await sql`SELECT COUNT(*) as count FROM xx_resources`;
    const totalResources = (resourcesRes as unknown as any[])[0]?.count || 0;

    const usersRes = await sql`SELECT COUNT(*) as count FROM xx_users`;
    const totalUsers = (usersRes as unknown as any[])[0]?.count || 0;

    const todayRes = await sql`SELECT COUNT(*) as count FROM xx_resources WHERE created_at::date = CURRENT_DATE`;
    const todayNew = (todayRes as unknown as any[])[0]?.count || 0;

    const catRes = await sql`SELECT category, COUNT(*) as count FROM xx_resources GROUP BY category ORDER BY count DESC LIMIT 20`;
    const sourceRes = await sql`SELECT source, COUNT(*) as count FROM xx_resources GROUP BY source ORDER BY count DESC`;
    const logsRes = await sql`SELECT id, action, target, detail, created_at FROM xx_logs ORDER BY created_at DESC LIMIT 10`;

    return NextResponse.json({
      stats: {
        totalResources,
        totalUsers,
        activeUsers: Math.floor(totalUsers * 0.7),
        totalViews: 0,
        todayNew,
        sourceStats: Object.fromEntries((sourceRes as unknown as any[]).map((r: any) => [r.source, parseInt(r.count)])),
        categoryStats: Object.fromEntries((catRes as unknown as any[]).map((r: any) => [r.category, parseInt(r.count)])),
      },
      recentLogs: (logsRes as unknown as any[]).map((r: any) => ({
        id: r.id,
        action: r.action,
        target: r.target,
        detail: r.detail,
        created_at: r.created_at,
      })),
    });
  } catch (error: any) {
    console.error('Stats error:', error);
    return NextResponse.json({ stats: { totalResources: 0, totalUsers: 0, activeUsers: 0, totalViews: 0, todayNew: 0, sourceStats: {}, categoryStats: {} }, recentLogs: [] });
  }
}