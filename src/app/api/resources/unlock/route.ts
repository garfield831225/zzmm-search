import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { recordClick } from '@/lib/track-click';  // 2026-10-20 异常用户登录: 全 API 点击计数
import { checkAndRecordThrottle } from '@/lib/throttle';  // 2026-08-16 viewer-role: 风控

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

function getUserId(authHeader: string | null): { userId?: string; email?: string; userGroup?: string; error?: string; status?: number } {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    return { userId: String(payload.id), email: payload.email, userGroup: payload.user_group || payload.userGroup };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

// v2.1 资源解锁: 流明消耗 + 周免费额度手动用 (2026-07-29 改)
// 2026-07-29: 周免费额度不再自动用, 需 use_credit=true 显式触发
// 解锁优先级:
//   1. admin → 免流明免额度
//   2. use_credit=true (VIP 显式) + 周额度还有 → 0 流明 + status='credit'
//   3. 否则 → 用流明 (lumen_balance >= lumen_cost) → status='lumen'
//   4. 流明不足 → 返 402, need='lumen', 附带 credit_left 让前端弹"用周额度"按钮
// 业务规则:
//   - VIP 每周 1 个免费解锁 (week_start=周日, 周日 0 点重置)
//   - basic/user 没周额度, 只能用流明
//   - 周额度只能手动 use_credit=true 才用, 不自动扣
async function unlockWithLumen(sql: any, userId: string, resourceId: number, useCredit: boolean = false) {
  // 1. 查资源 + lumen_cost + pay_type
  const resources = await sql`SELECT id, name, lumen_cost, access_level, pay_type FROM xx_resources WHERE id = ${resourceId} AND status = 'active' LIMIT 1` as any[];
  if (!resources[0]) return { error: '资源不存在', status: 404 };
  const r = resources[0];
  const lumenCost = r.lumen_cost || 1;
  // 2026-10-15: basic 用 5 credits 解锁 vip 资源 (pay_type='vip')
  //   - 当 use_credits=true + pay_type='vip' + userGroup='basic' → 走 credits 路径
  //   - 当 pay_type='vip' + userGroup 已经是 vip/svip/admin → 不需要解锁 (直开)
  //   - pay_type='code' 资源只能用流明
  const CREDITS_PER_VIP_UNLOCK = 5;

  // 2. 查用户状态 (JOIN xx_user_lumen + xx_user_points 拿 balance)
  const users = await sql`SELECT u.id, u.user_group, u.expire_at,
                                 COALESCE(l.balance, 0) as lumen_balance,
                                 COALESCE(p.points, 0) as points_balance
                            FROM xx_users u
                            LEFT JOIN xx_user_lumen l ON l.user_id = u.id
                            LEFT JOIN xx_user_points p ON p.user_id = u.id
                            WHERE u.id = ${userId} LIMIT 1` as any[];
  if (!users[0]) return { error: '用户不存在', status: 401 };
  const u = users[0];
  const isAdmin = u.user_group === 'admin';
  const isSvip = u.user_group === 'svip';
  const isVip = ['vip', 'svip', 'admin'].includes(u.user_group);
  const isBasic = u.user_group === 'basic';

  // 2026-10-15: svip 永久免 (code/lumen/vip 全免)
  if (isSvip) {
    await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, 0, NOW())`;
    return {
      success: true,
      message: '👑 svip 永久会员免流明打开',
      resource: { id: r.id, name: r.name },
      unlock_source: 'svip',
      is_admin_bypass: false,
      is_svip_bypass: true,
    };
  }

  // 3. 检查已解锁
  const existing = await sql`SELECT id FROM xx_user_unlocks WHERE user_id = ${userId} AND resource_id = ${resourceId} LIMIT 1` as any[];
  if (existing[0]) return { error: '您已解锁过此资源', status: 409 };

  // 4. 算本周周日 (按中国时区 UTC+8)
  const nowMs = Date.now();
  const chinaMs = nowMs + 8 * 3600 * 1000;
  const chinaDate = new Date(chinaMs);
  const cy = chinaDate.getUTCFullYear();
  const cm = chinaDate.getUTCMonth();
  const cd = chinaDate.getUTCDate();
  const dow = chinaDate.getUTCDay();
  const weekStartChina = new Date(Date.UTC(cy, cm, cd - dow));
  const weekStartDate = weekStartChina.toISOString().slice(0, 10);

  // 5. 查周免费额度 (admin 跳过; VIP 看周额度; basic/user 没额度)
  let creditAvailable = 0;
  if (isVip && !isAdmin) {
    const creditRow = await sql`
      INSERT INTO xx_user_weekly_credit (user_id, week_start, used, total, last_reset_at)
      VALUES (${userId}, ${weekStartDate}, 0, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        week_start = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN ${weekStartDate}::date
          ELSE xx_user_weekly_credit.week_start
        END,
        used = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN 0
          ELSE xx_user_weekly_credit.used
        END,
        last_reset_at = CASE
          WHEN xx_user_weekly_credit.week_start < ${weekStartDate}::date THEN NOW()
          ELSE xx_user_weekly_credit.last_reset_at
        END
      RETURNING used, total
    ` as any[];
    const used = creditRow[0]?.used ?? 0;
    const total = creditRow[0]?.total ?? 1;
    creditAvailable = Math.max(0, total - used);
  }

  // 6. 决定用 credit 还是 lumen
  let useCreditNow = false;
  let useCreditsPayType = false;  // 2026-10-15: basic 用 credits 解锁 vip 资源
  if (isAdmin) {
    useCreditNow = false;  // admin 走特殊分支
  } else if (useCredit && isVip && creditAvailable > 0) {
    // 用户显式要求用 credit, 且 VIP 还有额度
    useCreditNow = true;
  } else if (r.pay_type === 'vip' && isBasic) {
    // 2026-10-15: basic 解锁 vip 资源 (pay_type='vip') 必须用 credits (5 credits/条)
    //   vip/svip 本身直开, 不走 unlock
    //   admin 走 admin 分支
    useCreditsPayType = true;
  }
  // 其他情况: 默认走流明

  // 7. 检查余额 (admin 跳过; useCreditNow=true 跳过; useCreditsPayType 走 credits 检查)
  if (!isAdmin && !useCreditNow) {
    if (useCreditsPayType) {
      // basic 5 credits 解锁 vip 资源
      if ((u.points_balance || 0) < CREDITS_PER_VIP_UNLOCK) {
        return {
          error: `积分不足, 需要 ${CREDITS_PER_VIP_UNLOCK} 积分解锁此 vip 资源, 当前 ${u.points_balance || 0} 积分`,
          need: 'credits', cost: CREDITS_PER_VIP_UNLOCK, balance: u.points_balance || 0, status: 402,
        };
      }
    } else if ((u.lumen_balance || 0) < lumenCost) {
      return {
        error: `流明不足, 需要 ${lumenCost} 个, 当前 ${u.lumen_balance || 0}`,
        need: 'lumen', cost: lumenCost, balance: u.lumen_balance || 0, status: 402,
        credit_available: creditAvailable,
      };
    }
  }

  // 8. 扣额度/流明/credits + 写 unlock 记录
  try {
    let balanceAfter = u.lumen_balance || 0;
    let creditsAfter = u.points_balance || 0;
    let unlockSource: 'admin' | 'svip' | 'credit' | 'lumen' | 'credits_unlock' = 'lumen';
    if (isAdmin) {
      await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, 0, NOW())`;
      unlockSource = 'admin';
    } else if (useCreditNow) {
      // VIP 显式用周免费额度
      await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, 0, NOW())`;
      await sql`UPDATE xx_user_weekly_credit SET used = used + 1, last_used_at = NOW() WHERE user_id = ${userId}`;
      unlockSource = 'credit';
    } else if (useCreditsPayType) {
      // 2026-10-15: basic 5 credits 解锁 vip 资源
      const updated = await sql`UPDATE xx_user_points SET points = points - ${CREDITS_PER_VIP_UNLOCK}, updated_at = NOW() WHERE user_id = ${userId} RETURNING points` as any[];
      await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, 0, NOW())`;
      creditsAfter = updated[0]?.points ?? 0;
      await sql`
        INSERT INTO xx_point_logs (user_id, type, amount, ref_id, note, created_at)
        VALUES (${userId}, ${-CREDITS_PER_VIP_UNLOCK}, ${resourceId}, ${`unlock vip 资源 #${resourceId} (-${CREDITS_PER_VIP_UNLOCK} 积分)`}, NOW())
      `.catch(() => {});
      unlockSource = 'credits_unlock';
    } else {
      // 用流明
      const updated = await sql`UPDATE xx_user_lumen SET balance = balance - ${lumenCost}, updated_at = NOW() WHERE user_id = ${userId} RETURNING balance` as any[];
      await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, ${lumenCost}, NOW())`;
      balanceAfter = updated[0]?.balance ?? 0;
      await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description)
                VALUES (${userId}, ${-lumenCost}, ${balanceAfter}, 'debit', null, ${'resource_unlock:' + resourceId})`.catch(() => {});
    }
    return {
      success: true,
      message:
        unlockSource === 'admin' ? '👑 admin 免流明打开' :
        unlockSource === 'credit' ? `✅ 周免费额度解锁! 本周还剩 ${creditAvailable - 1} 次` :
        unlockSource === 'credits_unlock' ? `✅ 5 积分解锁 vip 资源! 剩 ${creditsAfter} 积分` :
        `✅ 解锁成功! 扣 ${lumenCost} 流明`,
      resource: { id: r.id, name: r.name },
      unlock_source: unlockSource,
      lumen_cost: (isAdmin || useCreditNow || useCreditsPayType) ? 0 : lumenCost,
      credits_cost: useCreditsPayType ? CREDITS_PER_VIP_UNLOCK : 0,
      lumen_balance_after: balanceAfter,
      credits_balance_after: creditsAfter,
      credit_available: isVip ? Math.max(0, creditAvailable - (useCreditNow ? 1 : 0)) : 0,
      is_admin_bypass: isAdmin,
    };
  } catch (e: any) {
    return { error: '解锁失败: ' + e.message, status: 500 };
  }
}

export async function POST(req: NextRequest) {
  const auth = getUserId(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });
  // 2026-10-20: 全 API 点击计数 (fire-and-forget, 不阻塞 unlock 主流程)
  void recordClick(req, Number(auth.userId));

  // 2026-08-16 viewer-role: 风控检查
  //   - admin 不限速 (怕自误踢)
  //   - 其他用户 5min 30 unlock 阈值, 5 级惩罚
  if (auth.userGroup !== 'admin') {
    const throttle = await checkAndRecordThrottle(Number(auth.userId), 'unlock');
    if (!throttle.allowed) {
      return NextResponse.json({
        error: throttle.message || '操作过于频繁, 请稍后再试',
        banned: true,
        ban_until: throttle.banUntil?.toISOString() || null,
        remaining_ms: throttle.remainingMs,
        strike_count: throttle.strikeCount,
        reason: throttle.reason,
      }, { status: 429 });
    }
  }

  const body = await req.json().catch(() => ({}));
  const { code, resource_id, resourceId, use_lumen, use_credit } = body;
  const finalResourceId = resource_id || resourceId;

  if (!finalResourceId || !Number.isInteger(Number(finalResourceId))) {
    return NextResponse.json({ error: '缺少 resource_id' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // v2.1 模式 1: 流明消耗 / 周额度 (use_lumen=true / use_credit=true / 没传 code)
  if (!code || use_lumen === true || use_credit === true) {
    const result = await unlockWithLumen(sql, auth.userId!, Number(finalResourceId), use_credit === true);
    if (result.error) return NextResponse.json({ error: result.error, need: result.need, cost: result.cost, balance: result.balance, credit_available: (result as any).credit_available }, { status: result.status });
    return NextResponse.json(result);
  }

  // v1.0 老模式: 激活码解锁 (code_type='unlock')
  if (typeof code !== 'string' || !/^[A-Za-z0-9]{8}$/.test(code)) {
    return NextResponse.json({ error: '激活码格式错误（必须 8 位大小写字母数字）' }, { status: 400 });
  }

  // 1) 查码
  const codes = await sql`
    SELECT id, code, code_type, target_resource_id, price_at_issue,
           is_used, used_by, used_at, expires_at
    FROM xx_activation_codes
    WHERE code = ${code}
    LIMIT 1
  `;
  if (!codes[0]) {
    return NextResponse.json({ error: '激活码无效' }, { status: 404 });
  }
  const c = codes[0] as any;

  // 2) 校验类型 + 目标资源
  if (c.code_type !== 'unlock') {
    return NextResponse.json({ error: '该激活码不是资源解锁类型' }, { status: 400 });
  }
  if (c.target_resource_id !== Number(finalResourceId)) {
    return NextResponse.json({
      error: `该激活码只能解锁资源 #${c.target_resource_id}，不能用于 #${finalResourceId}`,
    }, { status: 400 });
  }

  // 3) 校验是否已用
  if (c.is_used) {
    return NextResponse.json({ error: '该激活码已被使用' }, { status: 409 });
  }

  // 4) 校验过期
  if (c.expires_at && new Date(c.expires_at) < new Date()) {
    return NextResponse.json({ error: '该激活码已过期' }, { status: 410 });
  }

  // 5) 校验用户未解锁过
  const existing = await sql`
    SELECT id FROM xx_user_unlocks
    WHERE user_id = ${auth.userId} AND resource_id = ${Number(finalResourceId)}
  `;
  if (existing[0]) {
    return NextResponse.json({ error: '您已解锁过此资源' }, { status: 409 });
  }

  // 6) 校验资源 pay_type='code'
  const resources = await sql`SELECT id, name, pay_type, code_price FROM xx_resources WHERE id = ${Number(finalResourceId)}`;
  if (!resources[0]) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  }
  if (resources[0].pay_type !== 'code') {
    return NextResponse.json({ error: '此资源不需要激活码' }, { status: 400 });
  }

  // 7) 写解锁记录 + mark 码已用（事务）
  try {
    await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${auth.userId}, used_at = NOW() WHERE id = ${c.id}`;
    await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, activation_code_id, unlocked_at) VALUES (${auth.userId}, ${Number(finalResourceId)}, ${c.id}, NOW())`;
  } catch (e: any) {
    return NextResponse.json({ error: '解锁失败: ' + e.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    message: '解锁成功！',
    resource: {
      id: resources[0].id,
      name: resources[0].name,
    },
  });
}
