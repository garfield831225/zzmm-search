import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

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

// v1.2 资源解锁: VIP 基础 + 流明消耗
// 双重鉴权逻辑:
//   1. 用户必须有 VIP (user_group IN ('vip', 'admin'))
//   2. 用户有足够流明 (lumen_balance >= resource.lumen_cost)
//   3. 扣流明 + 写 unlock 记录 (lumen_cost 审计)
async function unlockWithLumen(sql: any, userId: string, resourceId: number) {
  // 1. 查资源 + lumen_cost
  const resources = await sql`SELECT id, name, lumen_cost, access_level FROM xx_resources WHERE id = ${resourceId} AND status = 'active' LIMIT 1` as any[];
  if (!resources[0]) return { error: '资源不存在', status: 404 };
  const r = resources[0];
  const lumenCost = r.lumen_cost || 1;

  // 2. 查用户 VIP 状态
  const users = await sql`SELECT id, user_group, expire_at, lumen_balance FROM xx_users WHERE id = ${userId} LIMIT 1` as any[];
  if (!users[0]) return { error: '用户不存在', status: 401 };
  const u = users[0];
  const isVip = (u.user_group === 'vip' || u.user_group === 'admin') && (!u.expire_at || new Date(u.expire_at) > new Date());
  if (!isVip) {
    return { error: '需要 VIP 会员才能解锁资源', need: 'vip', status: 403 };
  }

  // 3. 检查已解锁
  const existing = await sql`SELECT id FROM xx_user_unlocks WHERE user_id = ${userId} AND resource_id = ${resourceId} LIMIT 1` as any[];
  if (existing[0]) return { error: '您已解锁过此资源', status: 409 };

  // 4. 检查流明余额
  if ((u.lumen_balance || 0) < lumenCost) {
    return { error: `流明不足, 需要 ${lumenCost} 个, 当前 ${u.lumen_balance || 0}`, need: 'lumen', cost: lumenCost, balance: u.lumen_balance || 0, status: 402 };
  }

  // 5. 扣流明 + 写 unlock 记录
  try {
    await sql`UPDATE xx_users SET lumen_balance = lumen_balance - ${lumenCost} WHERE id = ${userId}`;
    await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, lumen_cost, unlocked_at) VALUES (${userId}, ${resourceId}, ${lumenCost}, NOW())`;
  } catch (e: any) {
    return { error: '解锁失败: ' + e.message, status: 500 };
  }

  const after = await sql`SELECT lumen_balance FROM xx_users WHERE id = ${userId} LIMIT 1` as any[];
  return {
    success: true,
    message: `解锁成功! 消耗 ${lumenCost} 流明`,
    resource: { id: r.id, name: r.name },
    lumen_cost: lumenCost,
    lumen_balance_after: after[0]?.lumen_balance || 0,
  };
}

export async function POST(req: NextRequest) {
  const auth = getUserId(req.headers.get('authorization'));
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { code, resource_id, use_lumen } = body;

  if (!resource_id || !Number.isInteger(Number(resource_id))) {
    return NextResponse.json({ error: '缺少 resource_id' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // v1.2 模式 1: VIP + 流明消耗 (use_lumen=true 或没传 code)
  if (!code || use_lumen === true) {
    const result = await unlockWithLumen(sql, auth.userId!, Number(resource_id));
    if (result.error) return NextResponse.json({ error: result.error, need: result.need, cost: result.cost, balance: result.balance }, { status: result.status });
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
  if (c.target_resource_id !== Number(resource_id)) {
    return NextResponse.json({
      error: `该激活码只能解锁资源 #${c.target_resource_id}，不能用于 #${resource_id}`,
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
    WHERE user_id = ${auth.userId} AND resource_id = ${Number(resource_id)}
  `;
  if (existing[0]) {
    return NextResponse.json({ error: '您已解锁过此资源' }, { status: 409 });
  }

  // 6) 校验资源 pay_type='code'
  const resources = await sql`SELECT id, name, pay_type, code_price FROM xx_resources WHERE id = ${Number(resource_id)}`;
  if (!resources[0]) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  }
  if (resources[0].pay_type !== 'code') {
    return NextResponse.json({ error: '此资源不需要激活码' }, { status: 400 });
  }

  // 7) 写解锁记录 + mark 码已用（事务）
  try {
    await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${auth.userId}, used_at = NOW() WHERE id = ${c.id}`;
    await sql`INSERT INTO xx_user_unlocks (user_id, resource_id, activation_code_id, unlocked_at) VALUES (${auth.userId}, ${Number(resource_id)}, ${c.id}, NOW())`;
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
