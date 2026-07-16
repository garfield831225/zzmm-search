// 2026-07-16: 一次性 TG L3 迁移端点
// 加 xx_resources.l3_from + xx_telegram_l3_queue 表
// 加 idempotent, 重跑安全 (IF NOT EXISTS)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const sql = neon(process.env.DATABASE_URL || '');

  const results: any[] = [];

  // 1. 加 l3_from 列
  try {
    await sql`ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS l3_from INTEGER`;
    results.push({ step: 'add l3_from column', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'add l3_from column', status: 'error', msg: e.message?.slice(0, 200) });
  }

  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_xx_resources_l3_from ON xx_resources(l3_from) WHERE l3_from IS NOT NULL`;
    results.push({ step: 'index l3_from', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'index l3_from', status: 'error', msg: e.message?.slice(0, 200) });
  }

  // 2. 创建 xx_telegram_l3_queue 表
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS xx_telegram_l3_queue (
        id              SERIAL PRIMARY KEY,
        source_message_id BIGINT,
        parent_resource_id INTEGER,
        telegra_ph_url  TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        attempts        INTEGER NOT NULL DEFAULT 0,
        last_error      TEXT,
        fetched_html    TEXT,
        real_url        TEXT,
        real_url_password TEXT,
        result_resource_id INTEGER,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        processed_at    TIMESTAMP
      )
    `;
    results.push({ step: 'create xx_telegram_l3_queue', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'create xx_telegram_l3_queue', status: 'error', msg: e.message?.slice(0, 200) });
  }

  // 3. 索引
  try {
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_l3_queue_url ON xx_telegram_l3_queue(telegra_ph_url)`;
    results.push({ step: 'index queue url (unique)', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'index queue url (unique)', status: 'error', msg: e.message?.slice(0, 200) });
  }
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_l3_queue_status ON xx_telegram_l3_queue(status, created_at)`;
    results.push({ step: 'index queue status', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'index queue status', status: 'error', msg: e.message?.slice(0, 200) });
  }
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_l3_queue_parent ON xx_telegram_l3_queue(parent_resource_id) WHERE parent_resource_id IS NOT NULL`;
    results.push({ step: 'index queue parent', status: 'ok' });
  } catch (e: any) {
    results.push({ step: 'index queue parent', status: 'error', msg: e.message?.slice(0, 200) });
  }

  // 验证
  let verify: any = {};
  try {
    const colInfo = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'xx_resources' AND column_name = 'l3_from'
    `;
    verify.l3_from_column = colInfo[0] || null;
  } catch (e: any) {
    verify.l3_from_column = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const tblInfo = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'xx_telegram_l3_queue' ORDER BY ordinal_position
    `;
    verify.l3_queue_columns = tblInfo.map((c: any) => `${c.column_name}:${c.data_type}`);
  } catch (e: any) {
    verify.l3_queue_columns = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_telegram_l3_queue`;
    verify.l3_queue_count = cnt[0]?.cnt ?? 0;
  } catch (e: any) {
    verify.l3_queue_count = 'error: ' + e.message?.slice(0, 100);
  }

  return NextResponse.json({ ok: true, results, verify });
}
