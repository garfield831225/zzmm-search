// 2026-08-14: 跑 schema migration - 直接 inline SQL (neon 0.10 不支持 multi-statement)
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

process.env.DATABASE_URL = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8')
  .split('\n').find(l => l.startsWith('DATABASE_URL=')).split('=', 2)[1];

const sql = neon(process.env.DATABASE_URL);

const STATEMENTS = [
  // xx_charts_cache
  `CREATE TABLE IF NOT EXISTS xx_charts_cache (
    cache_key      TEXT PRIMARY KEY,
    provider_id    INT NOT NULL,
    region         TEXT NOT NULL,
    type           TEXT NOT NULL,
    data           JSONB NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    cached_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xx_charts_cache_expires ON xx_charts_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_xx_charts_cache_provider ON xx_charts_cache(provider_id, region, type)`,
  // xx_calendar_cache
  `CREATE TABLE IF NOT EXISTS xx_calendar_cache (
    cache_key      TEXT PRIMARY KEY,
    start_date     DATE NOT NULL,
    end_date       DATE NOT NULL,
    source         TEXT NOT NULL,
    data           JSONB NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    cached_at      TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xx_calendar_cache_expires ON xx_calendar_cache(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_xx_calendar_cache_date ON xx_calendar_cache(start_date, end_date)`,
  // xx_user_watchlist
  `CREATE TABLE IF NOT EXISTS xx_user_watchlist (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL,
    tmdb_id         TEXT NOT NULL,
    tmdb_type       TEXT NOT NULL,
    title           TEXT,
    notify_enabled  BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, tmdb_id, tmdb_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xx_user_watchlist_user ON xx_user_watchlist(user_id, notify_enabled)`,
  `CREATE INDEX IF NOT EXISTS idx_xx_user_watchlist_tmdb ON xx_user_watchlist(tmdb_id, tmdb_type)`,
];

console.log(`=== 跑 ${STATEMENTS.length} 个 SQL statement ===`);
for (let i = 0; i < STATEMENTS.length; i++) {
  try {
    await sql(STATEMENTS[i]);
    console.log(`  ${i + 1}/${STATEMENTS.length} OK`);
  } catch (e) {
    console.error(`  ${i + 1}/${STATEMENTS.length} FAIL:`, e.message);
    process.exit(1);
  }
}

console.log('\n=== 验证 3 张表 ===');
const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('xx_charts_cache','xx_calendar_cache','xx_user_watchlist')
  ORDER BY table_name
`;
for (const t of tables) {
  console.log(`  ${t.table_name} OK`);
}

console.log('\n=== 验证索引 ===');
const idx = await sql`
  SELECT tablename, indexname FROM pg_indexes
  WHERE schemaname = 'public' AND tablename IN ('xx_charts_cache','xx_calendar_cache','xx_user_watchlist')
  ORDER BY tablename, indexname
`;
for (const i of idx) console.log(`  ${i.tablename}.${i.indexname}`);

console.log('\n=== ✅ Migration 全部完成 ===');
