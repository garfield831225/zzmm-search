-- 2026-07-17: 资源-链接 1对N 改造 migration
-- 作用: 把 xx_resources 里 link/link_code/source 拆到 xx_resource_links 副表
-- 不动原 xx_resources 表 (兼容老查询, Phase 7 双轨读)
-- 业务规则 (用户 2026-07-17 拍板):
--   - 资源信息 1 条, 链接 N 条
--   - 文档 (category=文档) / 独立付费 (pay_type=code) 不合并, 1 资源 1 链接
--   - access_level 分开: 资源 + 链接各自有字段
--   - basic 免锁判定: import_channel='zezemom_excel' 才免锁 (不是 source=115)

-- ========================================
-- 1. xx_resource_links 副表 (资源 ↔ 链接 1对N)
-- ========================================
CREATE TABLE IF NOT EXISTS xx_resource_links (
  id              SERIAL PRIMARY KEY,
  resource_id     INTEGER NOT NULL REFERENCES xx_resources(id) ON DELETE CASCADE,
  source          VARCHAR(20) NOT NULL,                  -- 115/baidu/quark/aliyun/xunlei/123/uc/tianyi/yidong/magnet
  url             TEXT NOT NULL,
  password        VARCHAR(100) DEFAULT '',               -- 提取码 (兼容 link_code)
  sort            INTEGER DEFAULT 99,                    -- G5-a 全局写死: 1=115, 2=baidu, ..., 9=yidong, 10=magnet
  status          VARCHAR(20) DEFAULT 'active',          -- active/deleted
  access_level    VARCHAR(20) DEFAULT 'vip',             -- B2-b 链接独立 access_level
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 同一资源下同一 source 只能有一条 (防重复)
  CONSTRAINT xx_resource_links_unique UNIQUE (resource_id, source)
);

-- 索引: 按 resource_id 查所有链接 (详情页/列表 JOIN)
CREATE INDEX IF NOT EXISTS idx_xx_resource_links_resource_id
  ON xx_resource_links (resource_id);

-- 索引: 按 source 过滤 (统计 + 列表分桶)
CREATE INDEX IF NOT EXISTS idx_xx_resource_links_source
  ON xx_resource_links (source);

-- 索引: 按 status 过滤 (前端排除 deleted)
CREATE INDEX IF NOT EXISTS idx_xx_resource_links_status
  ON xx_resource_links (resource_id, status);

-- 索引: 按 sort 排
CREATE INDEX IF NOT EXISTS idx_xx_resource_links_sort
  ON xx_resource_links (resource_id, sort);

-- ========================================
-- 2. xx_link_feedback 表 (用户反馈)
-- ========================================
CREATE TABLE IF NOT EXISTS xx_link_feedback (
  id              SERIAL PRIMARY KEY,
  link_id         INTEGER REFERENCES xx_resource_links(id) ON DELETE CASCADE,  -- 可空: 老资源没 link_id 时允许
  resource_id     INTEGER NOT NULL REFERENCES xx_resources(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL,                     -- 提交人
  username        VARCHAR(50) NOT NULL,                 -- 冗余存储 (用户改名/删除不影响历史)
  source          VARCHAR(20) NOT NULL,                 -- 反馈针对的 source (冗余, 避免 JOIN)
  reason          VARCHAR(30) NOT NULL,                 -- 失效/限速/密码错/内容错/其他
  comment         TEXT DEFAULT '',                      -- 备注 (reason=其他 时必填)
  new_password    VARCHAR(100) DEFAULT '',              -- 密码错时, 用户补的新密码
  status          VARCHAR(20) DEFAULT 'pending',         -- pending/handled/ignored
  admin_note      TEXT DEFAULT '',                      -- admin 处理备注
  handled_by      INTEGER,                              -- 处理人 admin id
  handled_at      TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 索引: 用户查自己的历史
CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_user
  ON xx_link_feedback (user_id, created_at DESC);

-- 索引: admin 查待处理列表
CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_status
  ON xx_link_feedback (status, created_at DESC);

-- 索引: 按资源查反馈
CREATE INDEX IF NOT EXISTS idx_xx_link_feedback_resource
  ON xx_link_feedback (resource_id, created_at DESC);

-- ========================================
-- 3. xx_resources 加新字段 (按 G2 业务规则, 不破坏老数据)
-- ========================================
-- l3_from: TG L3 抓取队列用的, 已存在
-- is_multi_link: 标记这条资源是否有多链接 (前端快速判断要不要 JOIN 副表)
ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS is_multi_link BOOLEAN DEFAULT FALSE;

-- matched_tmdb_at: TMDB 匹配时间, 用于按时间窗口去重 (Phase 3 匹配)
ALTER TABLE xx_resources ADD COLUMN IF NOT EXISTS matched_tmdb_at TIMESTAMP WITH TIME ZONE;

-- 索引: 匹配端点查 tmdb_id IS NULL 的资源
CREATE INDEX IF NOT EXISTS idx_xx_resources_unmatched
  ON xx_resources (id) WHERE tmdb_id IS NULL AND status = 'active';

-- ========================================
-- 4. 更新统计 (可选, 不影响业务)
-- ========================================
-- 跑完 migration 后, 期望:
--   xx_resource_links 总数 = xx_resources active 总数 (每个老资源 1 链接)
--   后续新建的多链接资源, xx_resource_links 会有 N 条
