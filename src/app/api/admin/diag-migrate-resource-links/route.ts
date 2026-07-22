// 2026-07-17: 一次性 xx_resource_links + xx_link_feedback 迁移端点
// 资源-链接 1对N 改造 Phase 1
// 业务规则 (用户 2026-07-17 拍板):
//   - 资源信息 1 条 (xx_resources), 链接 N 条 (xx_resource_links)
//   - 文档 / 独立付费 不合并
//   - access_level 分开: 资源 + 链接各自有字段
//   - basic 免锁判定: import_channel='zezemom_excel' 才免锁
// 加 idempotent, 重跑安全 (IF NOT EXISTS / IF EXISTS)
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
  const addResult = (step: string, ok: boolean, msg?: string) => {
    results.push({ step, status: ok ? 'ok' : 'error', msg: msg?.slice(0, 200) });
  };

  // ========== 1. xx_resource_links 副表 ==========
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS xx_resource_links (
        id              SERIAL PRIMARY KEY,
        resource_id     INTEGER NOT NULL REFERENCES xx_resources(id) ON DELETE CASCADE,
        source          VARCHAR(20) NOT NULL,
        url             TEXT NOT NULL,
        password        VARCHAR(100) DEFAULT '',
        sort            INTEGER DEFAULT 99,
        status          VARCHAR(20) DEFAULT 'active',
        access_level    VARCHAR(20) DEFAULT 'vip',
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        CONSTRAINT xx_resource_links_unique UNIQUE (resource_id, source)
      )
    `;
    addResult('create xx_resource_links', true);
  } catch (e: any) {
    addResult('create xx_resource_links', false, e.message);
  }

  // 索引
  const linkIndexes = [
    { name: 'idx_xx_resource_links_resource_id', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_resource_links_resource_id ON xx_resource_links (resource_id)' },
    { name: 'idx_xx_resource_links_source', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_resource_links_source ON xx_resource_links (source)' },
    { name: 'idx_xx_resource_links_status', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_resource_links_status ON xx_resource_links (resource_id, status)' },
    { name: 'idx_xx_resource_links_sort', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_resource_links_sort ON xx_resource_links (resource_id, sort)' },
  ];
  for (const idx of linkIndexes) {
    try {
      await sql(idx.sql as any);
      addResult(idx.name, true);
    } catch (e: any) {
      addResult(idx.name, false, e.message);
    }
  }

  // ========== 2. xx_link_feedback 表 ==========
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS xx_link_feedback (
        id              SERIAL PRIMARY KEY,
        link_id         INTEGER REFERENCES xx_resource_links(id) ON DELETE CASCADE,
        resource_id     INTEGER NOT NULL REFERENCES xx_resources(id) ON DELETE CASCADE,
        user_id         INTEGER NOT NULL,
        username        VARCHAR(50) NOT NULL,
        source          VARCHAR(20) NOT NULL,
        reason          VARCHAR(30) NOT NULL,
        comment         TEXT DEFAULT '',
        new_password    VARCHAR(100) DEFAULT '',
        status          VARCHAR(20) DEFAULT 'pending',
        admin_note      TEXT DEFAULT '',
        handled_by      INTEGER,
        handled_at      TIMESTAMP WITH TIME ZONE,
        created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    addResult('create xx_link_feedback', true);
  } catch (e: any) {
    addResult('create xx_link_feedback', false, e.message);
  }

  const fbIndexes = [
    { name: 'idx_xx_link_feedback_user', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_user ON xx_link_feedback (user_id, created_at DESC)' },
    { name: 'idx_xx_link_feedback_status', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_status ON xx_link_feedback (status, created_at DESC)' },
    { name: 'idx_xx_link_feedback_resource', sql: 'CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_resource ON xx_link_feedback (resource_id, created_at DESC)' },
  ];
  for (const idx of fbIndexes) {
    try {
      await sql(idx.sql as any);
      addResult(idx.name, true);
    } catch (e: any) {
      addResult(idx.name, false, e.message);
    }
  }

  // ========== 3. xx_resources 新字段 ==========
  try {
    await sql`ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS is_multi_link BOOLEAN DEFAULT FALSE`;
    addResult('add xx_resources.is_multi_link', true);
  } catch (e: any) {
    addResult('add xx_resources.is_multi_link', false, e.message);
  }
  try {
    await sql`ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS matched_tmdb_at TIMESTAMP WITH TIME ZONE`;
    addResult('add xx_resources.matched_tmdb_at', true);
  } catch (e: any) {
    addResult('add xx_resources.matched_tmdb_at', false, e.message);
  }
  try {
    await sql`CREATE INDEX IF NOT EXISTS idx_xx_resources_unmatched ON xx_resources (id) WHERE tmdb_id IS NULL AND status = 'active'`;
    addResult('idx_xx_resources_unmatched', true);
  } catch (e: any) {
    addResult('idx_xx_resources_unmatched', false, e.message);
  }

  // ========== 4. 验证 ==========
  let verify: any = {};
  try {
    const linkCols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'xx_resource_links' ORDER BY ordinal_position
    `;
    verify.xx_resource_links_columns = linkCols.map((c: any) => `${c.column_name}:${c.data_type}`);
  } catch (e: any) {
    verify.xx_resource_links_columns = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const fbCols = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'xx_link_feedback' ORDER BY ordinal_position
    `;
    verify.xx_link_feedback_columns = fbCols.map((c: any) => `${c.column_name}:${c.data_type}`);
  } catch (e: any) {
    verify.xx_link_feedback_columns = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links`;
    verify.xx_resource_links_count = cnt[0]?.cnt ?? 0;
  } catch (e: any) {
    verify.xx_resource_links_count = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_link_feedback`;
    verify.xx_link_feedback_count = cnt[0]?.cnt ?? 0;
  } catch (e: any) {
    verify.xx_link_feedback_count = 'error: ' + e.message?.slice(0, 100);
  }
  try {
    const colCheck = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'xx_resources' AND column_name IN ('is_multi_link', 'matched_tmdb_at')
    `;
    verify.xx_resources_new_columns = colCheck.map((c: any) => c.column_name);
  } catch (e: any) {
    verify.xx_resources_new_columns = 'error: ' + e.message?.slice(0, 100);
  }

  const hasError = results.some(r => r.status === 'error');
  return NextResponse.json({ ok: !hasError, results, verify });
}
