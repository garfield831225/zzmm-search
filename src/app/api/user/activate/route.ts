import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

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
      return NextResponse.json({ error: '请先登录后再兑换', code: 'unauthenticated' }, { status: 401 });
    }
    const userId = String(payload.id);

    const body = await req.json().catch(() => ({}));
    const code = String(body.code || '').trim();
    if (!code) return NextResponse.json({ error: '请输入激活码' }, { status: 400 });
    if (!CODE_REGEX_14.test(code) && !CODE_REGEX_8.test(code)) {
      return NextResponse.json({ error: '激活码格式错误（XY-XXXX-XXXX-XXXX 或 8位）' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 查码 (带 channel/batch_id 信息)
    const codes = await sql`
      SELECT id, code, code_type, plan_id, duration, user_group, target_resource_id,
             price_at_issue, is_used, used_by, used_at, expires_at, channel, batch_id
      FROM xx_activation_codes WHERE code = ${code} LIMIT 1
    `;
    if (!codes[0]) return NextResponse.json({ error: '激活码无效' }, { status: 404 });
    const c: any = codes[0];
    if (c.is_used) {
      return NextResponse.json({
        error: `该激活码已被使用（${c.used_at ? new Date(c.used_at).toLocaleString('zh-CN') : ''}）`,
        code: 'already_used',
      }, { status: 409 });
    }
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      return NextResponse.json({ error: '该激活码已过期', code: 'expired' }, { status: 410 });
    }

    // === VIP 套餐码: 叠加 expire_at ===
    if (c.code_type === 'vip') {
      // 取用户当前 expire_at 和 user_group
      const users: any = await sql`SELECT user_group, expire_at FROM xx_users WHERE id = ${userId}`;
      if (!users[0]) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
      const currentExpire = users[0].expire_at;
      const newExpire = calcNewExpire(currentExpire, c.duration);

      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`UPDATE xx_users SET user_group = 'vip', expire_at = ${newExpire}, updated_at = NOW() WHERE id = ${userId}`;
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
          new_user_group: 'vip',
          message: c.duration === 0
            ? '🎉 永久 VIP 会员激活成功！享受全站资源'
            : `🎉 ${c.duration} 天 VIP 会员激活成功！到期时间: ${newExpire ? new Date(newExpire).toLocaleString('zh-CN') : '永久'}`,
        });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500 });
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
        });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500 });
      }
    }

    // === 单资源解锁码 ===
    if (c.code_type === 'unlock') {
      if (!c.target_resource_id) return NextResponse.json({ error: '单资源码未指定资源' }, { status: 400 });
      const existing = await sql`SELECT id FROM xx_user_unlocks WHERE user_id = ${userId} AND resource_id = ${c.target_resource_id}`;
      if (existing[0]) return NextResponse.json({ error: '您已解锁过此资源' }, { status: 409 });
      const resources = await sql`SELECT id, name FROM xx_resources WHERE id = ${c.target_resource_id}`;
      if (!resources[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, activation_code_id, unlocked_at) VALUES (${userId}, ${c.target_resource_id}, ${c.id}, NOW())`;
        return NextResponse.json({
          success: true, code_type: 'unlock',
          resource: { id: resources[0].id, name: resources[0].name },
          channel: c.channel, batch_id: c.batch_id,
          message: `✅ 解锁成功: ${resources[0].name}`,
        });
      } catch (e: any) {
        return NextResponse.json({ error: '解锁失败: ' + e.message }, { status: 500 });
      }
    }

    return NextResponse.json({ error: '未知激活码类型: ' + c.code_type }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function planLabelByPlanId(planId: string): string {
  const map: Record<string, string> = {
    'VIP-30D': '30 天会员',
    'VIP-180D': '半年会员',
    'VIP-365D': '年卡会员',
    'VIP-FOREVER': '永久会员',
  };
  return map[planId] || planId;
}
