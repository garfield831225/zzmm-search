import { pgTable, text, timestamp, boolean, integer, serial } from 'drizzle-orm/pg-core';

// ============ 资源表 ============
export const resources = pgTable('xx_resources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  link: text('link').notNull(),
  linkCode: text('link_code'),
  source: text('source').notNull(),
  category: text('category').notNull(),
  size: text('size'),
  type: text('type'),
  tags: text('tags').array(),
  tmdbId: text('tmdb_id'),
  imdbId: text('imdb_id'),
  status: text('status').default('pending'),
  validStatus: text('valid_status').default('unchecked'),
  validCheckedAt: timestamp('valid_checked_at'),
  uploadedBy: text('uploaded_by'),
  approvedBy: text('approved_by'),
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
  userGroup: text('user_group').default('free'),
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
  allowedCategories: text('allowed_categories').array(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 会员套餐表 ============
export const plans = pgTable('xx_plans', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  price: integer('price').default(0),
  duration: integer('duration').notNull(),
  userGroup: text('user_group').notNull(),
  permissions: text('permissions').array(),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 激活码表 ============
export const activationCodes = pgTable('xx_activation_codes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  planId: text('plan_id'),
  userGroup: text('user_group').notNull(),
  duration: integer('duration').notNull(),
  isUsed: boolean('is_used').default(false),
  usedBy: text('used_by'),
  usedAt: timestamp('used_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
});

// ============ 支付记录表 ============
export const payments = pgTable('xx_payments', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  planId: text('plan_id').notNull(),
  amount: integer('amount').notNull(),
  status: text('status').default('pending'),
  tradeNo: text('trade_no'),
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
  type: text('type').notNull(),
  description: text('description'),
  status: text('status').default('pending'),
  handledBy: text('handled_by'),
  handledAt: timestamp('handled_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 系统公告表 ============
export const announcements = pgTable('xx_announcements', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  type: text('type').default('info'),
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
  type: text('type').notNull(),
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

// ============ 下载记录表 ============
export const downloadLogs = pgTable('xx_download_logs', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  resourceId: integer('resource_id').notNull(),
  resourceName: text('resource_name'),
  source: text('source'),
  ip: text('ip'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ============ 用户封禁/冷却记录表 ============
export const userBlocks = pgTable('xx_user_blocks', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull(),
  blockType: text('block_type').notNull(),
  reason: text('reason'),
  expireAt: timestamp('expire_at'),
  createdAt: timestamp('created_at').defaultNow(),
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