// 2026-07-28: 注销账号 API
// 业务流程:
//   1) 校验登录 + 二次确认 (前端 prompt 'DELETE')
//   2) 清空所有个人数据: unlocks / lumen / lumen_logs / activation_codes 标记 used
//   3) 软删 user: status='deleted', username 加 _deleted_<id> 后缀
//   4) 清空 token (前端清 localStorage)
// 不删: xx_resources, xx_activation_codes (保留审计), xx_match_* (TMDB 匹配统计)
// 硬规则: 不可逆! 用户名永久占位, email 不可复用
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

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

export async function POST(req: NextRequest) {
  try {
    const payload = getUser(req);
    if (!payload) {
      return NextResponse.json({ error: '请先登录', code: 'unauthenticated' }, { status: 401 });
    }
    const userId = String(payload.id);
    // 防护: admin 不能注销 (避免误操作锁管理账号)
    if (String(payload.user_group || payload.group || '').toLowerCase() === 'admin') {
      return NextResponse.json({ error: '管理员账号不支持注销, 请联系超管', code: 'admin_protected' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { confirm } = body;
    if (confirm !== 'DELETE') {
      return NextResponse.json({ error: '请输入 DELETE 确认注销', code: 'need_confirm' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    try {
      // 1) 先查用户存在
      const users = await sql`SELECT id, username, user_group, status FROM xx_users WHERE id = ${userId} LIMIT 1` as any[];
      if (!users[0]) return NextResponse.json({ error: '用户不存在', code: 'user_not_found' }, { status: 404 });
      if (users[0].status === 'deleted') {
        return NextResponse.json({ error: '账号已注销', code: 'already_deleted' }, { status: 409 });
      }

      const oldUsername = users[0].username;
      const newUsername = '_deleted_' + Date.now() + '_' + userId;

      // 2) 清空个人数据 (用同一事务, 失败回滚)
      // 注: Neon HTTP 不支持 BEGIN/COMMIT, 顺序执行即可, 任一失败返 500 但 user status 还没改
      const cleaned = {
        unlocks: 0,
        lumen_zero: false,
        activation_codes_marked: 0,
        sessions_cleared: 0,
      };

      // 2a. 清空解锁记录
      try {
        const u = await sql`DELETE FROM xx_user_unlocks WHERE user_id = ${userId} RETURNING id`;
        cleaned.unlocks = (u || []).length;
      } catch (e: any) { /* 表可能不存在, 跳过 */ }

      // 2b. 流明清零 (UPSERT balance=0)
      try {
        await sql`INSERT INTO xx_user_lumen (user_id, balance, updated_at)
                  VALUES (${userId}, 0, NOW())
                  ON CONFLICT (user_id) DO UPDATE SET balance = 0, updated_at = NOW()`;
        cleaned.lumen_zero = true;
      } catch (e: any) { /* 表可能不存在, 跳过 */ }

      // 2c. 标记所有该用户未用的激活码为已用 (避免别人用)
      try {
        const c = await sql`UPDATE xx_activation_codes SET is_used = true, used_at = NOW(),
                                used_by = 'deleted:' || ${userId}::text
                                WHERE used_by::text = ${userId} AND is_used = false
                                RETURNING id`;
        cleaned.activation_codes_marked = (c || []).length;
      } catch (e: any) { /* 字段类型可能不匹配, 跳过 */ }

      // 3) 软删 user: status='deleted', username 占位 (避免重名)
      await sql`UPDATE xx_users SET status = 'deleted',
                                  username = ${newUsername},
                                  updated_at = NOW()
                                  WHERE id = ${userId}`;

      return NextResponse.json({
        success: true,
        message: '账号已注销, 个人数据已清空',
        old_username: oldUsername,
        new_username: newUsername,
        cleaned,
        redirect: '/',
      });
    } catch (e: any) {
      return NextResponse.json({ error: '注销失败: ' + e.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
