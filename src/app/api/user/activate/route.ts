import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    const token = authHeader.replace('Bearer ', '');
    let payload: any;
    try { payload = jwt.verify(token, JWT_SECRET); } catch {
      return NextResponse.json({ error: '登录已过期' }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const { code } = body;
    if (!code || typeof code !== 'string' || !/^[A-Za-z0-9]{8}$/.test(code)) {
      return NextResponse.json({ error: '激活码格式错误（必是 8 位大小写字母数字）' }, { status: 400 });
    }
    const sql = neon(process.env.DATABASE_URL || '');

    // 查码
    const codes = await sql`
      SELECT id, code, code_type, target_resource_id, price_at_issue, is_used, used_by, used_at, expires_at
      FROM xx_activation_codes WHERE code = ${code} LIMIT 1
    `;
    if (!codes[0]) return NextResponse.json({ error: '激活码无效' }, { status: 404 });
    const c = codes[0] as any;
    if (c.is_used) return NextResponse.json({ error: '该激活码已被使用' }, { status: 409 });
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      return NextResponse.json({ error: '该激活码已过期' }, { status: 410 });
    }

    const userId = String(payload.id);

    // 2026-06-04: 三种码类型
    if (c.code_type === 'basic') {
      // 基础会员码：发放型，0 价格 → 升 user.group = 'basic'
      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`UPDATE xx_users SET "group" = 'basic', updated_at = NOW() WHERE id = ${userId}`;
        return NextResponse.json({
          success: true, code_type: 'basic',
          message: '基础会员激活成功！现在可以看泽泽妈妈文档导入的所有资源。',
          new_group: 'basic',
        });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500 });
      }
    }

    if (c.code_type === 'vip') {
      // VIP 码：付费 → 升 user.group = 'vip'
      try {
        await sql`UPDATE xx_activation_codes SET is_used = true, used_by = ${userId}, used_at = NOW() WHERE id = ${c.id}`;
        await sql`UPDATE xx_users SET "group" = 'vip', updated_at = NOW() WHERE id = ${userId}`;
        return NextResponse.json({
          success: true, code_type: 'vip',
          message: 'VIP 会员激活成功！现在可以看所有文档导入的资源。',
          new_group: 'vip',
        });
      } catch (e: any) {
        return NextResponse.json({ error: '激活失败: ' + e.message }, { status: 500 });
      }
    }

    if (c.code_type === 'unlock') {
      // 单资源解锁码（现存的）
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
          message: '激活成功！',
          resource: { id: resources[0].id, name: resources[0].name },
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
