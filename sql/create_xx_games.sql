-- ===========================================================
-- xx_games 表 — 游戏资源（掌机 + PC + 未来扩展）
-- 与 xx_resources 分离，避免污染 4 万影视数据
-- ===========================================================
CREATE TABLE IF NOT EXISTS xx_games (
  id              SERIAL PRIMARY KEY,
  -- 基本信息
  name            TEXT NOT NULL,                  -- 游戏名
  platform        TEXT NOT NULL,                  -- Switch / PS5 / Xbox / PC / Steam / 3DS / PSP / PS2 / Wii ...
  sub_platform    TEXT,                           -- PC: 单机/网游/模拟器
  cover_url       TEXT,                           -- 封面图 (Rawg 抓 或 Excel 自带)
  description     TEXT,
  -- 资源信息
  link            TEXT NOT NULL,                  -- 115/百度/磁力/夸克/迅雷/ed2k
  link_code       TEXT,                           -- 提取码
  size            TEXT,                           -- "12.5GB"
  source          TEXT,                           -- 来源 (115/百度/磁力/...)
  -- 元数据
  release_date    DATE,                           -- 发售日
  publisher       TEXT,                           -- 发行商
  developer       TEXT,                           -- 开发商
  language        TEXT,                           -- 中文/英文/日语/多语言
  tags            JSONB DEFAULT '{}'::jsonb,      -- 灵活标签: {genre, mode, players, vip_only}
  -- 匹配状态
  rawg_id         INTEGER,                        -- Rawg 游戏 ID
  rawg_slug       TEXT,                           -- Rawg slug
  match_status    TEXT DEFAULT 'pending',         -- pending / matched / failed / manual
  match_attempted_at TIMESTAMPTZ,
  -- 权限 (V1: vip 专属 + 扩展)
  is_vip_only     BOOLEAN DEFAULT TRUE,           -- true = 必须 VIP; false = 付费会员(basic/vip/admin)
  access_level    TEXT DEFAULT 'vip',             -- free / basic / vip (与 xx_resources 对齐)
  -- 状态
  status          TEXT DEFAULT 'active',          -- active / hidden / deleted
  view_count      INTEGER DEFAULT 0,
  uploaded_by     TEXT,                           -- admin username
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_xx_games_platform     ON xx_games(platform);
CREATE INDEX IF NOT EXISTS idx_xx_games_vip         ON xx_games(is_vip_only) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_xx_games_status      ON xx_games(status);
CREATE INDEX IF NOT EXISTS idx_xx_games_created     ON xx_games(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_xx_games_match       ON xx_games(match_status) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_xx_games_name_trgm   ON xx_games USING gin (name gin_trgm_ops);
-- gin_trgm_ops 需要 pg_trgm 扩展; 启用不了就 fallback btree
-- 兜底: btree
CREATE INDEX IF NOT EXISTS idx_xx_games_name_btree  ON xx_games(LOWER(name));

-- updated_at 触发器 (跟 xx_resources 对齐)
CREATE OR REPLACE FUNCTION xx_games_touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_xx_games_touch ON xx_games;
CREATE TRIGGER trg_xx_games_touch BEFORE UPDATE ON xx_games
  FOR EACH ROW EXECUTE FUNCTION xx_games_touch_updated_at();

-- 注释
COMMENT ON TABLE xx_games IS '游戏资源库 — 掌机 + PC + 未来扩展; 不影响 xx_resources';
COMMENT ON COLUMN xx_games.platform IS 'Switch / PS5 / Xbox / PC / Steam / 3DS / PSP / PS2 / Wii / 等';
COMMENT ON COLUMN xx_games.sub_platform IS 'PC 子分类: 单机/网游/模拟器';
COMMENT ON COLUMN xx_games.is_vip_only IS 'true=必须 VIP; false=basic+ 可看; 留扩展空间';
COMMENT ON COLUMN xx_games.access_level IS 'free/basic/vip - 与 xx_resources 对齐';
COMMENT ON COLUMN xx_games.match_status IS 'pending=未匹配; matched=已抓封面; failed=抓失败; manual=手动指定';
