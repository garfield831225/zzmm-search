// 2026-07-20: Vercel cron 同步 Neon pooler
// 每 2 分钟写一个 noop 触发主 endpoint 同步, 避免 read replica lag 导致前端看到老数据
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    // 写一个无影响的 UPDATE 触发主 endpoint 立即同步到 read replica
    //   只改 updated_at, 不改业务数据
    await sql`UPDATE xx_resources SET updated_at = NOW() WHERE id = (SELECT MIN(id) FROM xx_resources)`;
    return NextResponse.json({ ok: true, synced_at: new Date().toISOString() });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
