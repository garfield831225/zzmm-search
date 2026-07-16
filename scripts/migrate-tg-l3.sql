-- 2026-07-16: TG L3 (telegra.ph) 抓取队列迁移
-- 不动已有表数据, 只 ADD COLUMN + CREATE TABLE

-- 1. xx_resources 加 l3_from 字段 (L3 资源的父 L2 资源 ID)
ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS l3_from INTEGER;
CREATE INDEX IF NOT EXISTS idx_xx_resources_l3_from ON xx_resources(l3_from) WHERE l3_from IS NOT NULL;

-- 2. xx_telegram_l3_queue 表 (telegra.ph URL 抓取队列)
CREATE TABLE IF NOT EXISTS xx_telegram_l3_queue (
  id              SERIAL PRIMARY KEY,
  source_message_id BIGINT,                              -- TG 消息 ID (调试用)
  parent_resource_id INTEGER,                            -- L2 在 xx_resources 的 ID
  telegra_ph_url  TEXT NOT NULL,                         -- telegra.ph 文章 URL
  status          TEXT NOT NULL DEFAULT 'pending',       -- pending / processing / done / failed
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  fetched_html    TEXT,                                  -- telegra.ph 文章 HTML
  real_url        TEXT,                                  -- 抓回来的真链接
  real_url_password TEXT,
  result_resource_id INTEGER,                            -- 插入 xx_resources 后的新资源 ID
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_l3_queue_url ON xx_telegram_l3_queue(telegra_ph_url);
CREATE INDEX IF NOT EXISTS idx_l3_queue_status ON xx_telegram_l3_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_l3_queue_parent ON xx_telegram_l3_queue(parent_resource_id) WHERE parent_resource_id IS NOT NULL;

-- 3. cron_jobs / xx_cron_log 如果存在, 不用动 (worker 走 Vercel cron 配置)
