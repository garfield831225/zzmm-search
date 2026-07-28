// 2026-07-28: 周日 0 点重置所有 VIP 周免费额度
// systemd timer: zzmm-credit-reset-weekly.timer 每周日 00:00:00
// 业务:
//   1) 周日 0 点: 把所有 week_start < 今天(CURRENT_DATE) 的 used 清 0
//   2) 同时把 week_start 推到本周周日
//   3) 写日志记录
import mod from '../node_modules/@neondatabase/serverless/index.js';
const { neon } = mod.default || mod;
const sql = neon(process.env.DATABASE_URL || '');

async function main() {
  console.log('[reset-weekly-credit] start at', new Date().toISOString());
  try {
    // 把所有过期的 week_start 推 + used 清 0
    const r = await sql`
      UPDATE xx_user_weekly_credit
      SET used = 0,
          week_start = (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::date,
          last_reset_at = NOW()
      WHERE week_start < (CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::date
      RETURNING user_id
    `;
    console.log(`[reset-weekly-credit] reset ${r.length} users`);

    // 顺便给没记录的新 VIP 用户初始化 (但这由 unlock API 触发, 不强求)
    console.log('[reset-weekly-credit] done');
  } catch (e) {
    console.error('[reset-weekly-credit] ERROR:', e.message);
    process.exit(1);
  }
}
main();
