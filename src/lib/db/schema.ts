import { pgTable, text, timestamp, boolean, integer, serial, pgSequence } from 'drizzle-orm/pg-core';

// ============ 资源表 ============
export const resources = pgTable('xx_resources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),           // 资源名称
  link: text('link').notNull(),            // 分享链接
  linkCode: text('link_code'),            // 提取码
  source: text('source').notNull(),        // 来源：115/百度/阿里/磁力/ed2k/迅雷/天翼/123
  category: text('category').notNull(),   // 分类：电影/剧集/动漫/综艺/音乐等
  size: text('size'),                     // 文件大小
  type: text('type'),                     // 类型：4K/1080P/720P等
  tags: text('tags').array(),              // 标签数组
  tmdbId: text('tmdb_id'),                // TMDB电影ID
  imdbId: text('imdb_id'),                // IMDB电影ID
  status: text('status').default('pending'), // pending/active/disabled
  validStatus: text('valid_status').default('unchecked'), // unchecked/valid/invalid
  validCheckedAt: timestamp('valid_checked_at'),
  uploadedBy: text('uploaded_by'),        // 上传用户ID
  approvedBy: text('approved_by'),        // 审核人ID
  approvedAt: timestamp('approved_at'),
  viewCount: integer('view_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============ TMDB缓存表 ============
export const tmdbCache = pgTable('xx_tmdb_cache', {
  tmdbId: text('tmdb_id').primaryKey(),
  title: text('title').notNull(),
  titleZh: text('title_zh'),
  posterPath: text('poster_path'),
  backdropPath: text('backdrop_path'),
  overview: text('overview'),
  releaseDate: text('release_date'),
  voteAverage: text('vote_average'),
  voteCount: text('vote_count'),
  genres: text('genres').array(),
  cachedAt: timestamp('cached_at').defaultNow(),
});

// ============ 用户表 ============
export const users = pgTable('xx_users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  userGroup: text('user_group').default('free'), // free/vip/premium/admin
  isAdmin: boolean('is_admin').default(false),
  isActive: boolean('is_active').default(true),
  expireAt: timestamp('expire_at'),
  createdAt: timestamp('created_at').defaultNow(),
  lastLoginAt: timestamp('last_login_at'),
  loginIp: text('login_ip'),
});

// ============ 用户组权限表 ============
export const userGroups = pgTable('xx_user_groups', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  canView: boolean('can_view').default(true),
  canUpload: boolean('can_upload').default(false),
  canComment: boolean('can_comment').default(false),
  canReport: boolean('can_report').default(false),
  maxDailySearch: integer('max_daily_search').default(100),
  allowedCategories: text('allowed_categories').array(), // 允许查看的分类，为空则全部
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 会员套餐表 ============
export const plans = pgTable('xx_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  price: integer('price').default(0),     // 价格（分）
  duration: integer('duration').notNull(), // 天数
  userGroup: text('user_group').notNull(), // 升级到的用户组
  permissions: text('permissions').array(), // 额外权限列表
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 激活码表 ============
export const activationCodes = pgTable('xx_activation_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  planId: text('plan_id'),                 // 对应套餐ID
  userGroup: text('user_group').notNull(),
  duration: integer('duration').notNull(), // 天数
  isUsed: boolean('is_used').default(false),
  usedBy: text('used_by'),               // 使用者ID
  usedAt: timestamp('used_at'),
  createdBy: text('created_by'),         // 创建者ID
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
});

// ============ 支付记录表 ============
export const payments = pgTable('xx_payments', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  planId: text('plan_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').default('pending'), // pending/paid/refunded/cancelled
  tradeNo: text('trade_no'),                // 第三方交易号
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 收藏表 ============
export const favorites = pgTable('xx_favorites', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  resourceId: integer('resource_id').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 举报表 ============
export const reports = pgTable('xx_reports', {
  id: serial('id').primaryKey(),
  userId: text('user_id'),
  resourceId: integer('resource_id').notNull(),
  type: text('type').notNull(),             // invalid_link/wrong_info/other
  description: text('description'),
  status: text('status').default('pending'), // pending/processed/resolved
  handledBy: text('handled_by'),
  handledAt: timestamp('handled_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 系统公告表 ============
export const announcements = pgTable('xx_announcements', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: text('type').default('info'),     // info/warning/error
  isTop: boolean('is_top').default(false),
  isActive: boolean('is_active').default(true),
  startAt: timestamp('start_at'),
  endAt: timestamp('end_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 线上文档配置表 ============
export const onlineDocConfigs = pgTable('xx_online_doc_configs', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),           // tencent/wps
  url: text('url').notNull(),
  enabled: boolean('enabled').default(true),
  lastFetchAt: timestamp('last_fetch_at'),
  lastFetchStatus: text('last_fetch_status'),
  fetchCount: integer('fetch_count').default(0),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 系统设置表 ============
export const systemSettings = pgTable('xx_system_settings', {
  id: serial('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value'),
  description: text('description'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ============ 操作日志表 ============
export const logs = pgTable('xx_logs', {
  id: serial('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  target: text('target'),
  detail: text('detail'),
  ip: text('ip'),
  createdAt: timestamp('created_at').defaultNow(),
});