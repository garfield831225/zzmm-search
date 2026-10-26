// cron/anti_abuse_check.mjs - 5 分钟扫描一次, 检查用户点击量, 触发锁/封号
// 2026-10-20 异常用户登录设计 用户拍板规则:
//   - Rule A: 1h 内 ≥500 次 click → status='banned' (admin 豁免)
//   - Rule B: 24h 内 ≥1000 次 → locked_until = NOW() + 2h, lock_reason='click_1000'
//   - Rule C: 24h 内 ≥500 次 → locked_until = NOW() + 1h, lock_reason='click_500'
//   - 优先级: A > B > C (取最严的)
//   - admin 自动 ban 豁免 (locked_until 仍生效)
//   - skip status='banned' 已经封的, 避免反复处理
//
// 用法: node cron/anti_abuse_check.mjs (systemd timer 5min 跑一次)
// 依赖: DATABASE_URL env, pg 通过 @neondatabase/serverless (跟主项目一致)
//
// 注: 每次只 UPDATE 一次, 不反复 lock. 已经 locked 的不重复 trigger 除非进入新的窗口.
import { neon, neonConfig } from '@neondatabase/serverless';
import { Client } from 'pg';

neonConfig.fetchConnectionCache = false;

const CLICK_THRESHOLDS = {
  oneH_ban: 500,     // 1h ≥ 500 click → 永久封号
  oneH_window: '1 hour',
  day24_lock1h: 500, // 24h ≥ 500 click → 锁 1h
  day24_lock2h: 1000, // 24h ≥ 1000 click → 锁 2h
  day24_window: '24 hours',
};

const LOCK_DURATIONS = {
  click_500: 3600,       // 1 hour in seconds
  click_1000: 7200,      // 2 hours in seconds
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[anti_abuse_check] DATABASE_URL not set, exit');
    process.exit(1);
  }

  // 用 pg 直连 (HTTPS neon HTTP INSERT 卡死, SELECT 没问题, 但我们 SELECT 完还要 UPDATE, 走 pg 更稳)
  // 用 process.env.DATABASE_URL 直连本机 psql 端口 (5432), 跟 Neon serverless 同步
  const client = new Client({
    connectionString: dbUrl.replace('?sslmode=require', '').replace('&channel_binding=require', ''),
  });
  await client.connect();
  try {
    const ts = new Date().toISOString();
    console.log(`[${ts}] anti_abuse_check start`);

    // 1. Rule A: 1h 内 click ≥ 500 → banned (admin 豁免)
    const bannedRowsRes = await client.query(`
      SELECT ua.user_id, COUNT(*) as cnt
      FROM xx_user_actions ua
      JOIN xx_users u ON ua.user_id = u.id
      WHERE ua.action_type = 'click'
        AND ua.created_at >= NOW() - INTERVAL '1 hour'
        AND u.user_group <> 'admin'
        AND u.status = 'active'
      GROUP BY ua.user_id
      HAVING COUNT(*) >= ${CLICK_THRESHOLDS.oneH_ban}
    `);
    let banCount = 0;
    for (const r of bannedRowsRes.rows) {
      try {
        const upd = await client.query(
          `UPDATE xx_users SET status = 'banned', lock_reason = 'banned_click', updated_at = NOW() WHERE id = $1 AND user_group <> 'admin' AND status = 'active'`,
          [r.user_id]
        );
        if (upd.rowCount && upd.rowCount > 0) {
          banCount++;
          console.log(`[banned] user_id=${r.user_id} cnt=${r.cnt} → status=banned`);
          // 顺便清 token: 删 cookie 要前端做, 后端无法 clear; 但下次 middleware 查 status !== 'active' 会踢
        }
      } catch (e) {
        console.error(`[banned] user ${r.user_id} update failed:`, e.message);
      }
    }

    // 2. Rule B+C: 24h 内 click ≥ 500 → locked (优先级 1000 > 500)
    //   - WHERE locked_until IS NULL OR locked_until < NOW() (避免反复 lock 同一用户)
    //   - 先取所有 ≥500 的, 再判 ≥1000 的二次覆盖
    const lockRowsRes = await client.query(`
      SELECT ua.user_id, COUNT(*) as cnt
      FROM xx_user_actions ua
      JOIN xx_users u ON ua.user_id = u.id
      WHERE ua.action_type = 'click'
        AND ua.created_at >= NOW() - INTERVAL '24 hours'
        AND u.user_group <> 'admin'
        AND u.status = 'active'
        AND (u.locked_until IS NULL OR u.locked_until <= NOW())
      GROUP BY ua.user_id
      HAVING COUNT(*) >= ${CLICK_THRESHOLDS.day24_lock1h}
    `);
    let lock1hCount = 0, lock2hCount = 0;
    for (const r of lockRowsRes.rows) {
      const cnt = Number(r.cnt);
      let durSec, reason;
      if (cnt >= CLICK_THRESHOLDS.day24_lock2h) {
        durSec = LOCK_DURATIONS.click_1000; reason = 'click_1000'; lock2hCount++;
      } else {
        durSec = LOCK_DURATIONS.click_500; reason = 'click_500'; lock1hCount++;
      }
      try {
        const upd = await client.query(
          `UPDATE xx_users SET locked_until = NOW() + ($2 || ' seconds')::interval, lock_reason = $3, updated_at = NOW() WHERE id = $1 AND user_group <> 'admin' AND status = 'active'`,
          [r.user_id, durSec, reason]
        );
        if (upd.rowCount && upd.rowCount > 0) {
          console.log(`[locked] user_id=${r.user_id} cnt=${cnt} reason=${reason} dur=${durSec}s`);
        }
      } catch (e) {
        console.error(`[locked] user ${r.user_id} update failed:`, e.message);
      }
    }

    console.log(`[${new Date().toISOString()}] anti_abuse_check done: banned=${banCount} lock_500=${lock1hCount} lock_1000=${lock2hCount}`);
  } catch (e) {
    console.error('[anti_abuse_check] error:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[anti_abuse_check] uncaught:', e);
  process.exit(1);
});
