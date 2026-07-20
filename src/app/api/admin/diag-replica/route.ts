// 2026-07-21: 临时 diag - 看 read replica 状态 + replication lag
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const a = authAdmin(req);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const recovery = await sql`SELECT pg_is_in_recovery() as in_recovery`;
    const rep = await sql`SELECT client_addr, state, sync_state, sent_lsn, replay_lsn, sync_priority
      FROM pg_stat_replication` as any[];
    let neonInfo: any = null;
    try {
      neonInfo = await sql`SELECT * FROM neon.neon_stat_replication` as any[];
    } catch (e) { neonInfo = e.message; }

    return NextResponse.json({
      in_recovery: recovery[0]?.in_recovery,
      pg_stat_replication: rep,
      neon_replication: neonInfo,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
