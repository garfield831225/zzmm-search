-- =============================================================
-- zzmm-vip 影视区 3 张表
-- 日期: 2026-07-24
-- 部署: Neon (同 zzmm-search 现有库)
-- 前缀: xx_vip_
-- =============================================================

-- -------------------------------------------------------------
-- 1. xx_vip_resources - TMDB 元数据
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xx_vip_resources (
  id BIGSERIAL PRIMARY KEY,

  -- TMDB 标识
  tmdb_id INTEGER NOT NULL,
  media_type VARCHAR(10) NOT NULL CHECK (media_type IN ('movie','tv')),

  -- 基础信息
  title TEXT NOT NULL,
  original_title TEXT,
  original_language VARCHAR(10),

  -- 图片路径 (TMDB CDN: image.tmdb.org/t/p/...)
  poster_path TEXT,
  backdrop_path TEXT,

  -- 详情
  overview TEXT,
  vote_average NUMERIC(4,2),
  vote_count INTEGER,
  release_date DATE,         -- 电影用
  first_air_date DATE,       -- 剧集用
  genre_ids INTEGER[],

  -- 排序权重
  popularity NUMERIC(10,3),
  vote_score NUMERIC(4,2) GENERATED ALWAYS AS
    (CASE WHEN vote_count > 100 THEN vote_average ELSE NULL END) STORED,

  -- 剧集专属
  season_count INTEGER,
  episode_count INTEGER,
  status VARCHAR(20),        -- 'Released' / 'Returning Series' / 'Ended'
  last_episode_to_air JSONB, -- 最后一集播出信息
  next_episode_to_air JSONB, -- 下一集播出信息 (连载剧)

  -- 电影专属
  runtime INTEGER,           -- 片长（分钟）
  adult BOOLEAN DEFAULT FALSE,

  -- 同步元信息
  raw_json JSONB,            -- TMDB 原始 JSON 备份
  tmdb_fetched_at TIMESTAMP,

  -- 系统字段
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uniq_xx_vip_resources_tmdb UNIQUE (tmdb_id, media_type)
);

CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_media_type
  ON xx_vip_resources(media_type);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_popularity
  ON xx_vip_resources(popularity DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_release_date
  ON xx_vip_resources(release_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_first_air_date
  ON xx_vip_resources(first_air_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_vote_score
  ON xx_vip_resources(vote_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_tmdb
  ON xx_vip_resources(tmdb_id);
CREATE INDEX IF NOT EXISTS idx_xx_vip_resources_genre
  ON xx_vip_resources USING GIN(genre_ids);

-- 触发器: 自动更新 updated_at
CREATE OR REPLACE FUNCTION trg_xx_vip_resources_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_xx_vip_resources_upd ON xx_vip_resources;
CREATE TRIGGER trg_xx_vip_resources_upd
  BEFORE UPDATE ON xx_vip_resources
  FOR EACH ROW EXECUTE FUNCTION trg_xx_vip_resources_updated_at();

-- -------------------------------------------------------------
-- 2. xx_vip_links - 第三方播放链接
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xx_vip_links (
  id BIGSERIAL PRIMARY KEY,

  resource_id BIGINT NOT NULL REFERENCES xx_vip_resources(id) ON DELETE CASCADE,

  -- 来源信息
  source VARCHAR(50) NOT NULL,        -- 'xingfan' / 后续可加 'lzm' / 'ckplayer' 等
  source_url TEXT,                    -- xingfan 详情页 URL（用于重试匹配）

  -- 播放链接（剧集每集一条，电影一条）
  play_url TEXT NOT NULL,
  season INTEGER,                     -- 剧集季 (1-based, 电影留空)
  episode INTEGER,                    -- 剧集集 (1-based, 电影留空)
  episode_title TEXT,                 -- 集标题

  -- 健康状态
  status VARCHAR(20) NOT NULL DEFAULT 'unchecked'
    CHECK (status IN ('ok','dead','unchecked','blocked')),
  match_confidence NUMERIC(4,3),      -- 匹配置信度 0-1
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_check_at TIMESTAMP,
  last_ok_at TIMESTAMP,               -- 最近一次验证 OK 的时间

  -- 元信息
  matched_via VARCHAR(50),            -- 'title_search' / 'manual' / 'tmdb_id' 等
  raw_html_hash TEXT,                 -- 详情页 hash, 用于检测内容变化

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT uniq_xx_vip_links_resource UNIQUE (resource_id, source, season, episode)
);

CREATE INDEX IF NOT EXISTS idx_xx_vip_links_resource
  ON xx_vip_links(resource_id);
CREATE INDEX IF NOT EXISTS idx_xx_vip_links_status
  ON xx_vip_links(status);
CREATE INDEX IF NOT EXISTS idx_xx_vip_links_source
  ON xx_vip_links(source);
CREATE INDEX IF NOT EXISTS idx_xx_vip_links_last_check
  ON xx_vip_links(last_check_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_xx_vip_links_resource_ok
  ON xx_vip_links(resource_id) WHERE status = 'ok';

DROP TRIGGER IF EXISTS trg_xx_vip_links_upd ON xx_vip_links;
CREATE TRIGGER trg_xx_vip_links_upd
  BEFORE UPDATE ON xx_vip_links
  FOR EACH ROW EXECUTE FUNCTION trg_xx_vip_resources_updated_at();

-- -------------------------------------------------------------
-- 3. xx_vip_sync_log - 同步记录
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xx_vip_sync_log (
  id BIGSERIAL PRIMARY KEY,

  sync_type VARCHAR(20) NOT NULL CHECK (sync_type IN ('tmdb','xingfan','verify','cleanup')),
  source VARCHAR(50),                       -- 哪个数据源 (e.g. 'tmdb:popular' / 'xingfan')

  status VARCHAR(20) NOT NULL CHECK (status IN ('running','success','partial','failed','cancelled')),

  total_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  skip_count INTEGER DEFAULT 0,

  error_msg TEXT,
  detail JSONB,                             -- 详细记录 (e.g. 失败列表前 20 条)

  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMP,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_xx_vip_sync_log_type_time
  ON xx_vip_sync_log(sync_type, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_xx_vip_sync_log_status
  ON xx_vip_sync_log(status);

-- -------------------------------------------------------------
-- 4. 视图: 排序 + 链接状态（给 /vip 列表用）
-- -------------------------------------------------------------
CREATE OR REPLACE VIEW v_xx_vip_resources_with_link AS
SELECT
  r.*,
  l.id AS link_id,
  l.play_url,
  l.source AS link_source,
  l.status AS link_status,
  l.last_ok_at AS link_last_ok_at,
  l.match_confidence
FROM xx_vip_resources r
LEFT JOIN LATERAL (
  SELECT *
  FROM xx_vip_links
  WHERE resource_id = r.id
    AND status = 'ok'
  ORDER BY
    season NULLS FIRST,
    episode NULLS FIRST,
    last_ok_at DESC NULLS LAST
  LIMIT 1
) l ON true;

COMMENT ON VIEW v_xx_vip_resources_with_link IS
  '用于 /vip 列表页: 每条资源 + 1 个最佳播放链接';

-- -------------------------------------------------------------
-- 5. 验证
-- -------------------------------------------------------------
DO $$
BEGIN
  RAISE NOTICE 'xx_vip_resources: % rows', (SELECT COUNT(*) FROM xx_vip_resources);
  RAISE NOTICE 'xx_vip_links: % rows', (SELECT COUNT(*) FROM xx_vip_links);
  RAISE NOTICE 'xx_vip_sync_log: % rows', (SELECT COUNT(*) FROM xx_vip_sync_log);
END $$;
