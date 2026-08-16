import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { rateLimit, getClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 2026-08-13: 公共 API (moviezone + 子站) - 加 CORS 头
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// 2026-08-10: VIP 1-day 激活码每个账号每月限领 1 次 (自然月, 每月 1 号 0 点刷)
//   - 硬规则: code_type='vip' AND duration=1 的码, 同一 user 同一自然月只能成功领一次
//   - 不影响 30/90/365/永久 码
//   - 失败返 429 + code='monthly_limit_exceeded' + next_available_at (下月 1 号 ISO)

// 三种码格式: 14位带前缀 (XY-/WD-) / 8位 (旧) / 自定义 (vip_custom)
// 14位: XY-ABCD-EFGH-IJKL
const CODE_REGEX_14 = /^[A-Z]{2}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/;
const CODE_REGEX_8 = /^[A-Za-z0-9]{8}$/;

function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  let token = '';
  if (auth?.startsWith('Bearer ')) {
    token = auth.replace('Bearer ', '');
  } else {
    token = req.cookies.get('zzmm_token')?.value
         || req.cookies.get('token')?.value
         || '';
  }
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch { return null; }
}

// 计算新的 expire_at
// 规则: 在现有 expire_at 基础上叠加 duration (续费不缩短)
// 永久码 (duration=0) → expire_at = NULL
// 新用户 (expire_at=NULL 或 已过期) → NOW() + duration
function calcNewExpire(currentExpire: string | null, duration: number): string | null {
  if (duration === 0) return null; // 永久
  const now = new Date();
  const cur = currentExpire ? new Date(currentExpire) : null;
  // 续费叠加: 如果当前还有效, 在 cur 基础上 + duration, 否则 NOW() + duration
  const base = (cur && cur > now) ? cur : now;
  return new Date(base.getTime() + duration * 24 * 60 * 60 * 1000).toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const payload = getUser(req);
    if (!payload) {
      return NextResponse.json({ error: '请先登录后再兑换', code: 'unauthenticated' }, { status: 401, headers: CORS_HEADERS });
    }
    const userId = String(payload.id);

    // 限流: 单用户 10 次/小时
    const rl = rateLimit(`activate:${userId}:${getClientIp(req.headers)}`, { limit: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: '兑换太频繁，请稍后再试', code: 'rate_limited', resetIn: Math.ceil(rl.resetIn / 1000) }, { status: 429, headers: CORS_HEADERS });
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim();
    if (!code) return NextResponse.json({ error: '请输入激活码' }, { status: 400, headers: CORS_HEADERS });
    if (!CODE_REGEX_14.test(code) && !CODE_REGEX_8.test(code)) {
      return NextResponse.json({ error: '激活码格式错误（XY-XXXX-XXXX-XXXX 或 8位）' }, { status: 400, headers: CORS_HEADERS });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 查码 (带 channel/batch_id 信息) - 用 UPPER 不区分大小写, 用户输全大写也能匹配
    const codes = await sql`
      SELECT id, code, code_type, plan_id, duration, user_group, target_resource_id,
             price_at_issue, lumen_amount, is_used, used_by, used_at, expires_at, channel, batch_id
      FROM xx_activation_codes WHERE UPPER(code) = UPPER(${code}) LIMIT 1
    `;
    if (!codes[0]) return NextResponse.json({ error: '激活码无效' }, { status: 404, headers: CORS_HEADERS });
    const c: any = codes[0];
    if (c.is_used) {
      return NextResponse.json({
        error: `该激活码已被使用（${c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : ''}）`,
        code: 'already_used',
      }, { status: 409, headers: CORS_HEADERS });
    }
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      return NextResponse.json({ error: '该激活码已过期', code: 'expired' }, { status: 410, headers: CORS_HEADERS });
    }

    // === VIP 套餐码: 叠加 expire_at ===
    if (c.code_type === 'vip') {
      // 2026-08-10: VIP 1-day 每月限领 1 次 (自然月) - 在标码 is_used 之前检查
      //   - 月份定义: date_trunc('month', NOW()) (PostgreSQL 自然月, 每月 1 号 0 点刷)
      //   - 不影响 30/90/365/永久 码 (duration != 1 跳过)
      if (c.duration === 1) {
        const monthDup = await sql`
          SELECT id, used_at
          FROM xx_activation_codes
          WHERE used_by = ${userId}
            AND code_type = 'vip'
            AND duration = 1
            AND is_used = true
            AND used_at >= date_trunc('month', NOW())
          LIMIT 1
        `;
        if ((monthDup as any[])[0]) {
          const lastUsed = new Date((monthDup as any[])[0].used_at);
          // 下月 1 号 0 点
          const nextAvailable = new Date(lastUsed.getFullYear(), lastUsed.getMonth() + 1, 1, 0, 0, 0);
          return NextResponse.json({
            error: `本月已领过 1 天 VIP 激活码 (上次: ${lastUsed.toLocaleString('zh-CN')}), 下次可领: ${nextAvailable.toLocaleString('zh-CN')}`,
            code: 'monthly_limit_exceeded',
            next_available_at: nextAvailable.toISOString(),
          }, { status: 429, headers: CORS_HEADERS });
        }
      }

      // 取用户当前 expire_at 和 user_group + registration_source
      const users: any = await sql`SELECT user_group, expire_at, registration_source FROM xx_users WHERE id = ${userId}`;
      if (!users[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404, headers: CORS_HEADERS });
      const currentExpire = users[0].expire_at;
      const newExpire = calcNewExpire(currentExpire, c.duration);

      // 2026-08-17 viewer-role: viewer 申请用户 (registration_source='viewer_apply')
      //   即使有 VIP 码也只进 viewer 限制的页面 (拍板 B 方案: 升 user_group='vip' 但加 viewer_locked)
      //   实现: 码标记已用, user_group 升 vip, **registration_source 不变** (让 AuthGuard 检查时仍走 viewer 限制)
      //   写 lumen_logs 记录此次尝试
      const isViewerApply = users[0].registration_source === 'viewer_apply';
      const newUserGroup = isViewerApply ? 'vip' : 'vip';  // 两种都升 vip (viewer 通过 registration_source 标志被 AuthGuard 拦截)

      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`UPDATE xx_users SET user_group = ${newUserGroup}, expire_at = ${newExpire}, updated_at = NOW() WHERE id = ${userId}`;
        // 写 lumen_logs (用户升 vip 行为日志, 含 viewer_apply 警告)
        await sql`
          INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
          VALUES (${userId}, 0, 0, ${isViewerApply ? 'viewer_vip_blocked' : 'vip_upgrade'}, ${c.code}, ${isViewerApply
            ? `viewer 申请用户 (registration_source=viewer_apply) 尝试激活 VIP 码, 码标记已用, user_group 升 vip 但 AuthGuard 会拦截 (需邀请码完整解封), 计划: ${c.duration === 0 ? '永久' : c.duration + ' 天'}`
            : `VIP 升级 ${c.duration} 天, expire_at: ${newExpire || '永久'}`}, NOW())
        `.catch(() => {});

        return NextResponse.json({
          success: true,
          code_type: 'vip',
          plan_id: c.plan_id,
          plan_label: c.duration === 0 ? '永久会员' : (c.plan_id === 'VIP-CUSTOM-' + c.duration + 'D' ? `${c.duration} 天会员` : planLabelByPlanId(c.plan_id)),
          duration_days: c.duration,
          channel: c.channel,
          channel_label: c.channel === 'wd' ? '微店' : (c.channel === 'xy' ? '闲鱼' : ''),
          batch_id: c.batch_id,
          old_expire_at: currentExpire,
          new_expire_at: newExpire,
          new_user_group: newUserGroup,
          // 2026-08-17 viewer 申请用户返 viewer_locked=true 提示
          viewer_locked: isViewerApply,
          message: isViewerApply
            ? `⚠️ 您是 viewer 档用户, VIP 码已标记使用 + user_group 已升 vip, 但仍受 viewer 限制 (仅 library + 个人主页 + 流明购买).\n\n💡 完整解封需邀请码 (向 admin 申请 basic 邀请码), 邀请码会改 registration_source='admin' 永久解封.\n\n拿到邀请码后去 /register 用邀请码注册新号, 再用 admin 后台 "用户列表" 合并原 viewer 账号的资源访问权限.`
            : (c.duration === 0
              ? '🎉 永久 VIP 会员激活成功！享受全站资源'
              : `🎉 ${c.duration} 天 VIP 会员激活成功！到期时间: ${newExpire ? new Date(newExpire).toLocaleString('zh-CN') : '永久'}`),
        }, { headers: CORS_HEADERS });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500, headers: CORS_HEADERS });
      }
    }

    // === 基础会员码 (兼容旧) ===
    if (c.code_type === 'basic') {
      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`UPDATE xx_users SET user_group = 'basic', updated_at = NOW() WHERE id = ${userId}`;
        return NextResponse.json({
          success: true, code_type: 'basic',
          new_user_group: 'basic',
          channel: c.channel, batch_id: c.batch_id,
          message: '基础会员激活成功！现在可以看泽泽妈妈文档导入的所有资源。',
        }, { headers: CORS_HEADERS });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500, headers: CORS_HEADERS });
      }
    }

    // === 流明充值码 (2026-06-25) ===
    if (c.code_type === 'lumen') {
      const amount = c.lumen_amount || 0;
      if (amount <= 0) return NextResponse.json({ error: '流明数量无效' }, { status: 400, headers: CORS_HEADERS });
      try {
        // 标记码已用 + 累加流明 (UPSERT xx_user_lumen)
        const updated = await sql`
          INSERT INTO xx_user_lumen (user_id, balance, updated_at)
          VALUES (${userId}, ${amount}, NOW())
          ON CONFLICT (user_id) DO UPDATE SET balance = xx_user_lumen.balance + ${amount}, updated_at = NOW()
          RETURNING balance
        ` as any[];
        const balanceAfter = updated[0]?.balance ?? amount;
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description)
                  VALUES (${userId}, ${amount}, ${balanceAfter}, 'credit', ${code}, 'lumen_code_redeem')`.catch(() => {});
        return NextResponse.json({
          success: true, code_type: 'lumen',
          lumen_amount: amount,
          lumen_balance_after: balanceAfter,
          channel: c.channel, batch_id: c.batch_id,
          message: `✅ 充值成功！获得 ${amount} 流明，当前余额 ${balanceAfter}`,
        }, { headers: CORS_HEADERS });
      } catch (e: any) {
        return NextResponse.json({ error: '充值失败: ' + e.message }, { status: 500, headers: CORS_HEADERS });
      }
    }

    // === 单资源解锁码 ===
    if (c.code_type === 'unlock') {
      if (!c.target_resource_id) return NextResponse.json({ error: '单资源码未指定资源' }, { status: 400, headers: CORS_HEADERS });
      const existing = await sql`SELECT id FROM xx_user_unlocks WHERE user_id = ${userId} AND resource_id = ${c.target_resource_id}`;
      if (existing[0]) return NextResponse.json({ error: '您已解锁过此资源' }, { status: 409, headers: CORS_HEADERS });
      const resources = await sql`SELECT id, name FROM xx_resources WHERE id = ${c.target_resource_id}`;
      if (!resources[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404, headers: CORS_HEADERS });
      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, activation_code_id, unlocked_at) VALUES (${userId}, ${c.target_resource_id}, ${c.id}, NOW())`;
        return NextResponse.json({
          success: true, code_type: 'unlock',
          resource: { id: resources[0].id, name: resources[0].name },
          channel: c.channel, batch_id: c.batch_id,
          message: `✅ 解锁成功: ${resources[0].name}`,
        }, { headers: CORS_HEADERS });
      } catch (e: any) {
        return NextResponse.json({ error: '解锁失败: ' + e.message }, { status: 500, headers: CORS_HEADERS });
      }
    }

    return NextResponse.json({ error: '未知激活码类型: ' + c.code_type }, { status: 400, headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS_HEADERS });
  }
}

function planLabelByPlanId(planId: string): string {
  const map: Record<string, string> = {
    'VIP-30D': '30 天会员',
    'VIP-180D': '季卡会员',
    'VIP-365D': '年卡会员',
    'VIP-FOREVER': '永久会员',
  };
  return map[planId] || planId;
}
