-- 2026-08-14: 观影推荐 + 追剧日历 + 用户追剧清单 (3 张新表)
-- 1) xx_charts_cache: 榜单 cache (5 平台 × 10 国家 × movie/tv = 100 keys)
-- 2) xx_calendar_cache: 追剧日历 cache (CST 北京时间, 30 天/批)
-- 3) xx_user_watchlist: 用户追剧清单 + 推送开关

-- ===== xx_charts_cache =====
CREATE TABLE IF NOT EXISTS xx_charts_cache (
  cache_key      TEXT PRIMARY KEY,
  provider_id    INT NOT NULL,
  region         TEXT NOT NULL,
  type           TEXT NOT NULL,  -- 'movie' | 'tv'
  data           JSONB NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  cached_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_xx_charts_cache_expires
  ON xx_charts_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_xx_charts_cache_provider
  ON xx_charts_cache(provider_id, region, type);

-- ===== xx_calendar_cache =====
CREATE TABLE IF NOT EXISTS xx_calendar_cache (
  cache_key      TEXT PRIMARY KEY,
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  source         TEXT NOT NULL,  -- 'simkl' | 'tvmaze' | 'merged'
  data           JSONB NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  cached_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_xx_calendar_cache_expires
  ON xx_calendar_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_xx_calendar_cache_date
  ON xx_calendar_cache(start_date, end_date);

-- ===== xx_user_watchlist =====
CREATE TABLE IF NOT EXISTS xx_user_watchlist (
  id              SERIAL PRIMARY KEY,
  user_id         INT NOT NULL,
  tmdb_id         TEXT NOT NULL,
  tmdb_type       TEXT NOT NULL,  -- 'movie' | 'tv'
  title           TEXT,
  notify_enabled  BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, tmdb_id, tmdb_type)
);
CREATE INDEX IF NOT EXISTS idx_xx_user_watchlist_user
  ON xx_user_watchlist(user_id, notify_enabled);
CREATE INDEX IF NOT EXISTS idx_xx_user_watchlist_tmdb
  ON xx_user_watchlist(tmdb_id, tmdb_type);

-- 备份: 万一用户反悔, DROP 顺序按依赖反过来
-- DROP TABLE IF EXISTS xx_user_watchlist;
-- DROP TABLE IF EXISTS xx_calendar_cache;
-- DROP TABLE IF EXISTS xx_charts_cache;
