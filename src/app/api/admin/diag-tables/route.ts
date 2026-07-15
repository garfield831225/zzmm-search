// 临时 diag 端点: 查 cover 表是否存在
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TABLES = ['xx_music_cache', 'xx_cover_cache', 'xx_sports_cache', 'xx_resources', 'xx_tmdb_cache'];

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');
  const out: any = {};
  for (const t of TABLES) {
    try {
      const r = await sql(`SELECT 1 FROM ${t} LIMIT 1`);
      out[t] = { exists: true, sample_count: 'N/A' };
    } catch (e: any) {
      out[t] = { exists: false, error: e.message?.slice(0, 200) };
    }
  }
  return NextResponse.json(out);
}
