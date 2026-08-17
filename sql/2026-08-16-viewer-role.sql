-- =============================================================
-- zzmm-search viewer 档位 + 待确认流程 + 风控体系
-- 日期: 2026-08-16
-- 部署: Neon (preview 3005 → main 3004)
-- 前缀: xx_users 加字段 + xx_user_throttle 新表
-- =============================================================

-- -------------------------------------------------------------
-- 1. xx_users 加字段 (viewer 档 + pending 状态 + 微信审核)
-- -------------------------------------------------------------
-- ALTER 加列都带 DEFAULT 兼容老数据, 老 user 0 影响
ALTER TABLE xx_users
  ADD COLUMN IF NOT EXISTS registration_source VARCHAR(20) DEFAULT 'main',
  -- 'main' 主站邀请码 / 'viewer_apply' library 申请 / 'admin' 后台创建
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES xx_users(id),
  ADD COLUMN IF NOT EXISTS wechat_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS wechat_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS application_reason TEXT,
  -- 申请理由 (申请文档资源站时填)
  ADD COLUMN IF NOT EXISTS reject_reason TEXT;
  -- admin 拒绝时填

-- 状态: 'pending' (viewer 待审) / 'active' (正常) / 'banned' (封号)
-- status 字段已存在, 不用加

-- 索引: 待确认用户列表查询
CREATE INDEX IF NOT EXISTS idx_xx_users_status_pending
  ON xx_users (status, created_at DESC)
  WHERE status = 'pending';

-- user_group 现在允许的值: 'user' / 'viewer' / 'basic' / 'vip' / 'admin'
-- 旧值 'member' = 'basic' 别名 (历史遗留, 不动)

-- -------------------------------------------------------------
-- 2. xx_user_throttle 风控表
-- -------------------------------------------------------------
-- 5 级惩罚:
--   ban_level 0 = 正常
--   ban_level 1 = 30 分钟内禁止
--   ban_level 2 = 1 天禁止
--   ban_level 3 = 3 天禁止
--   ban_level 4 = 7 天禁止
--   ban_level 5 = 永久封号
--
-- 触发条件: 5 分钟内 download > 30 次
-- 每次升级: ban_level + 1
--
-- 字段:
--   user_id - 用户
--   ban_level - 当前惩罚等级
--   ban_until - 解除时间 (NULL = 永久)
--   strike_count - 历史违规次数 (跨 ban 期累加)
--   last_violation_at - 上次违规时间
--   last_window_start - 当前 5 分钟窗口起点
--   window_count - 当前窗口内 download 次数
--   created_at / updated_at
CREATE TABLE IF NOT EXISTS xx_user_throttle (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES xx_users(id) ON DELETE CASCADE,
  ban_level INTEGER NOT NULL DEFAULT 0,
  ban_until TIMESTAMP,
  strike_count INTEGER NOT NULL DEFAULT 0,
  last_violation_at TIMESTAMP,
  last_window_start TIMESTAMP NOT NULL DEFAULT NOW(),
  window_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_xx_user_throttle_ban_until
  ON xx_user_throttle (ban_until)
  WHERE ban_until IS NOT NULL;

-- -------------------------------------------------------------
-- 3. xx_user_throttle_logs 违规历史 (审计用)
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xx_user_throttle_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES xx_users(id) ON DELETE CASCADE,
  violation_type VARCHAR(50) NOT NULL,
  -- 'rate_limit' (5min 30 unlock) / 'ban_lift' (到期解除) / 'manual_ban' (admin 操作)
  previous_level INTEGER NOT NULL,
  new_level INTEGER NOT NULL,
  window_count INTEGER,
  details JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xx_user_throttle_logs_user
  ON xx_user_throttle_logs (user_id, created_at DESC);

-- -------------------------------------------------------------
-- 4. xx_pending_user_applications 待审申请 (跟 xx_users.status='pending' 配合)
-- -------------------------------------------------------------
-- 跟 xx_users 共享 user_id, 不重复存基本信息
-- 用于后台"待确认注册列表"展示更详细的申请信息
CREATE TABLE IF NOT EXISTS xx_pending_user_applications (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES xx_users(id) ON DELETE CASCADE,
  registration_source VARCHAR(20) NOT NULL,
  -- 'viewer_apply' (从主站无邀请码注册) / 'admin_invite' (admin 后台邀请)
  application_reason TEXT,
  -- 申请人填的理由 (自由文本)
  contact_info JSONB,
  -- 备用联系方式 (电话/邮箱 - 申请时填)
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- 'pending' / 'approved' / 'rejected' / 'cancelled'
  reviewed_by INTEGER REFERENCES xx_users(id),
  reviewed_at TIMESTAMP,
  review_note TEXT,
  -- 审核备注
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_xx_pending_apps_status
  ON xx_pending_user_applications (status, created_at DESC);

-- -------------------------------------------------------------
-- 5. user_group 字段加 CHECK 约束 (可选, 不强加避免阻塞老数据)
-- -------------------------------------------------------------
-- 跳过, 老数据 'member' 等历史值不能 fail
-- 后续 application 层校验

-- -------------------------------------------------------------
-- 6. 初始化已有 admin/zzmm-search
-- -------------------------------------------------------------
-- 已有用户 status 都是 'active', 不动
-- 把 admin 设置 approved_at + approved_by
UPDATE xx_users
SET approved_at = COALESCE(approved_at, created_at),
    approved_by = COALESCE(approved_by, 1)
WHERE status = 'active' AND approved_at IS NULL;

-- 验证
SELECT 'migration 2026-08-16-viewer-role 完成' AS result;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'xx_users' AND column_name IN
  ('registration_source', 'approved_at', 'approved_by', 'wechat_name', 'wechat_id', 'application_reason', 'reject_reason');
SELECT 'xx_user_throttle' AS table_name, count(*) AS rows FROM xx_user_throttle;
SELECT 'xx_user_throttle_logs' AS table_name, count(*) AS rows FROM xx_user_throttle_logs;
SELECT 'xx_pending_user_applications' AS table_name, count(*) AS rows FROM xx_pending_user_applications;
