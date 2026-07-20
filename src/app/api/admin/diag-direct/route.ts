// 2026-07-20: 诊断 Vercel neon() 实际连的 endpoint
// 临时端点, 用完删
import { neon } from '@neondatabase/serverless';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.DATABASE_URL || '';
  const m = url.match(/ep-([^.]+)\.([^.]+)\.([^/]+)/);
  const endpoint = m ? `ep-${m[1]}` : 'unknown';
  const region = m ? `${m[2]}.${m[3]}` : 'unknown';

  const sql = neon(url);

  const c = await sql`SELECT
    (SELECT COUNT(*)::int FROM xx_resources WHERE name ILIKE '%万米危机%' AND status = 'active') as active_wanmi,
    (SELECT COUNT(*)::int FROM xx_resources WHERE status = 'active') as total_active,
    NOW() as query_time`;

  return NextResponse.json({
    env_endpoint: endpoint,
    env_region: region,
    is_pooler: url.includes('-pooler'),
    url_pattern: url.replace(/:[^@]+@/, ':***@'),
    result: c[0],
  });
}
