-- 2026-07-24: xx_vip_links 加 m3u8_url 字段 (存 playerla 内的真 m3u8 链接)
ALTER TABLE xx_vip_links
  ADD COLUMN IF NOT EXISTS m3u8_urls JSONB,  -- array of {source, url, expires_at, fetched_at}
  ADD COLUMN IF NOT EXISTS m3u8_fetched_at TIMESTAMPTZ;

COMMENT ON COLUMN xx_vip_links.m3u8_urls IS 'playerla HTML 内的 m3u8 真链列表 (带 token+expires), [{source, url, expires_at, fetched_at}]';
COMMENT ON COLUMN xx_vip_links.m3u8_fetched_at IS 'm3u8 抓取时间';
