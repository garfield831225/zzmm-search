// 2026-08-16 viewer-role + 风控体系
// 5min 30 unlock 阈值 + 5 级惩罚 (30min/1day/3days/7days/封号)
//
// 触发位置: /api/resources/unlock (主消费点) + /api/bounty/* (用户操作)
//
// 字段:
//   - ban_level 0 正常 / 1 30min / 2 1day / 3 3days / 4 7days / 5 永久封号
//   - ban_until 解除时间 (NULL = 永久)
//   - strike_count 跨 ban 累加违规次数
//
// 实现: xx_user_throttle 表, 用滑动窗口 (5min)
//   - 第一次 ban 解除后 strike_count=1, 第二次 ban 解除后 strike_count=2 ...

import { neon, neonConfig } from '@neondatabase/serverless';

neonConfig.fetchConnectionCache = false;

export const THROTTLE_CONFIG = {
  WINDOW_MS: 5 * 60 * 1000,        // 5 分钟
  WINDOW_THRESHOLD: 30,             // 5min 内 30 次触发
  BAN_LEVELS: {
    0: { duration: 0,               desc: '正常' },
    1: { duration: 30 * 60 * 1000,  desc: '30 分钟' },  // 30min
    2: { duration: 24 * 60 * 60 * 1000, desc: '1 天' },  // 1day
    3: { duration: 3 * 24 * 60 * 60 * 1000, desc: '3 天' },  // 3days
    4: { duration: 7 * 24 * 60 * 60 * 1000, desc: '7 天' },  // 7days
    5: { duration: null,             desc: '永久封号' },  // 永久
  },
} as const;

const sql0 = () => neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

/**
 * 检查 + 累加 download 次数
 * @param userId 用户 ID
 * @param action 'unlock' / 'bounty' / 'download'
 * @returns
 *   - allowed: true=可继续, false=被 ban 中
 *   - banUntil: 解除时间 (null = 永久, undefined = 正常)
 *   - remainingMs: 剩余 ms (0 = 正常)
 *   - strikeCount: 当前 strike 数
 *   - reason: 'rate_limit' | 'banned' | 'ok'
 */
export async function checkAndRecordThrottle(
  userId: number,
  action: 'unlock' | 'bounty' | 'download' = 'unlock'
): Promise<{
  allowed: boolean;
  banUntil: Date | null;
  remainingMs: number;
  strikeCount: number;
  reason: 'ok' | 'rate_limit' | 'banned';
  message?: string;
}> {
  const sql = sql0();
  const now = new Date();
  const nowMs = now.getTime();

  // 1. 查 throttle 行
  let r = await sql`SELECT * FROM xx_user_throttle WHERE user_id = ${userId} LIMIT 1` as any[];
  let t = r[0];

  // 2. 首次访问初始化
  if (!t) {
    try {
      await sql`
        INSERT INTO xx_user_throttle (user_id, ban_level, ban_until, strike_count, last_window_start, window_count, created_at, updated_at)
        VALUES (${userId}, 0, NULL, 0, NOW(), 0, NOW(), NOW())
        ON CONFLICT (user_id) DO NOTHING
      `;
      r = await sql`SELECT * FROM xx_user_throttle WHERE user_id = ${userId} LIMIT 1` as any[];
      t = r[0];
    } catch (e: any) {
      // 表不存在 (migration 没跑) → 放行 (容错)
      console.warn('[throttle] xx_user_throttle 初始化失败 (可能 migration 未跑):', e.message);
      return { allowed: true, banUntil: null, remainingMs: 0, strikeCount: 0, reason: 'ok' };
    }
  }

  if (!t) {
    return { allowed: true, banUntil: null, remainingMs: 0, strikeCount: 0, reason: 'ok' };
  }

  // 3. 永久封号 → 永远拒绝
  if (t.ban_level >= 5) {
    return {
      allowed: false,
      banUntil: null,
      remainingMs: -1,
      strikeCount: t.strike_count,
      reason: 'banned',
      message: '账号已被永久封禁',
    };
  }

  // 4. 检查 ban 是否还在生效
  if (t.ban_until) {
    const banUntilMs = new Date(t.ban_until).getTime();
    if (banUntilMs > nowMs) {
      const remaining = banUntilMs - nowMs;
      const desc = THROTTLE_CONFIG.BAN_LEVELS[t.ban_level as 1 | 2 | 3 | 4]?.desc || `${t.ban_level}`;
      return {
        allowed: false,
        banUntil: new Date(banUntilMs),
        remainingMs: remaining,
        strikeCount: t.strike_count,
        reason: 'banned',
        message: `操作过于频繁, 账号已被限制 ${desc}, 剩余 ${formatMs(remaining)}`,
      };
    }
    // ban 到期, 重置 ban_level=0 但保留 strike_count
    try {
      await sql`
        UPDATE xx_user_throttle
        SET ban_level = 0, ban_until = NULL, window_count = 0, last_window_start = NOW(), updated_at = NOW()
        WHERE user_id = ${userId}
      `;
    } catch {}
  }

  // 5. 滑动窗口检查: 5min 内累加 window_count
  const lastWindowStartMs = new Date(t.last_window_start).getTime();
  const windowExpired = (nowMs - lastWindowStartMs) > THROTTLE_CONFIG.WINDOW_MS;

  let newWindowCount: number;
  let newWindowStart: Date;
  if (windowExpired) {
    // 新窗口
    newWindowCount = 1;
    newWindowStart = now;
  } else {
    newWindowCount = (t.window_count || 0) + 1;
    newWindowStart = new Date(lastWindowStartMs);
  }

  // 6. 超阈值 → 升级 ban
  if (newWindowCount > THROTTLE_CONFIG.WINDOW_THRESHOLD) {
    const oldLevel = t.ban_level;
    const newLevel = Math.min(5, oldLevel + 1);
    const banLevelInfo = THROTTLE_CONFIG.BAN_LEVELS[newLevel as 1 | 2 | 3 | 4 | 5];
    const banUntil = banLevelInfo.duration ? new Date(nowMs + banLevelInfo.duration) : null;
    const newStrikeCount = (t.strike_count || 0) + 1;

    try {
      await sql`
        UPDATE xx_user_throttle
        SET ban_level = ${newLevel},
            ban_until = ${banUntil ? banUntil.toISOString() : null},
            strike_count = ${newStrikeCount},
            last_violation_at = NOW(),
            window_count = 0,
            last_window_start = NOW(),
            updated_at = NOW()
        WHERE user_id = ${userId}
      `;

      // 写违规日志
      await sql`
        INSERT INTO xx_user_throttle_logs (user_id, violation_type, previous_level, new_level, window_count, details, created_at)
        VALUES (${userId}, 'rate_limit', ${oldLevel}, ${newLevel}, ${newWindowCount}, ${JSON.stringify({ action, threshold: THROTTLE_CONFIG.WINDOW_THRESHOLD, window_ms: THROTTLE_CONFIG.WINDOW_MS })}::jsonb, NOW())
      `.catch(() => {});

      // ban_level=5 → 同步把 user status 改成 'banned'
      if (newLevel >= 5) {
        await sql`UPDATE xx_users SET status = 'banned', updated_at = NOW() WHERE id = ${userId}`.catch(() => {});
      }
    } catch (e: any) {
      console.error('[throttle] 升级 ban 失败:', e.message);
    }

    if (banUntil) {
      return {
        allowed: false,
        banUntil,
        remainingMs: banLevelInfo.duration || 0,
        strikeCount: newStrikeCount,
        reason: 'rate_limit',
        message: `${banLevelInfo.desc}内禁止访问 (第 ${newStrikeCount} 次违规, 此前已 ${oldLevel === 0 ? '无' : oldLevel} 次)`,
      };
    } else {
      return {
        allowed: false,
        banUntil: null,
        remainingMs: -1,
        strikeCount: newStrikeCount,
        reason: 'banned',
        message: '账号已被永久封禁',
      };
    }
  }

  // 7. 正常 → 累加 window_count
  try {
    await sql`
      UPDATE xx_user_throttle
      SET window_count = ${newWindowCount},
          last_window_start = ${newWindowStart.toISOString()},
          updated_at = NOW()
      WHERE user_id = ${userId}
    `;
  } catch (e: any) {
    console.error('[throttle] 累加 window_count 失败:', e.message);
  }

  return {
    allowed: true,
    banUntil: null,
    remainingMs: 0,
    strikeCount: t.strike_count || 0,
    reason: 'ok',
  };
}

function formatMs(ms: number): string {
  if (ms < 0) return '永久';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} 分钟`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时 ${min % 60} 分`;
  const day = Math.floor(hr / 24);
  return `${day} 天 ${hr % 24} 小时`;
}
