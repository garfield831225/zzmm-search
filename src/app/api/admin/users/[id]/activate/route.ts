// 2026-08-30: admin 一键升级 viewer 客户
//   POST /api/admin/users/[id]/activate
//   body: { mode: 'vip' | 'basic' }
//   - vip  : viewer -> vip, expire_at 保留 viewer 当前值 (用户已买 VIP 时间)
//   - basic: viewer -> basic, expire_at = NULL (永久, 等同邀请码注册的 basic)
//   - 必须 target user_group='viewer' AND status='active' (pending 还在 /admin/pending-users)
//   - admin auth
//   - 写 xx_lumen_logs (type='admin_activate', description 含 admin id + 旧→新 group)
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

neonConfig.fetchConnectionCache = false;
const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 1. admin auth
  const a = authAdmin(req);
  if (a.error || !a.userId) {
    return NextResponse.json({ error: a.error || '未登录', code: 'unauthenticated' }, { status: a.status || 401 });
  }
  const adminId = a.userId;

  // 2. 解析 user_id + mode
  const userId = parseInt(params.id || '', 10);
  if (!userId || userId <= 0) {
    return NextResponse.json({ error: 'user_id 无效', code: 'bad_id' }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode || '').toLowerCase();
  if (!['vip', 'basic'].includes(mode)) {
    return NextResponse.json({ error: "mode 必须是 'vip' 或 'basic'", code: 'bad_mode' }, { status: 400 });
  }

  try {
    // 3. 查目标用户
    const target = await sql`
      SELECT id, username, user_group, expire_at::text, status
      FROM xx_users WHERE id = ${userId} LIMIT 1
    ` as any[];
    if (!target[0]) {
      return NextResponse.json({ error: '用户不存在', code: 'not_found' }, { status: 404 });
    }
    const u = target[0];
    if (u.user_group !== 'viewer') {
      return NextResponse.json(
        { error: `只能升级 viewer 客户, 当前用户 group = '${u.user_group}'`, code: 'not_viewer', current_group: u.user_group },
        { status: 400 }
      );
    }
    if (u.status !== 'active') {
      return NextResponse.json(
        { error: `viewer 客户必须先在 /admin/pending-users 通过审核 (当前 status=${u.status})`, code: 'not_active', current_status: u.status },
        { status: 400 }
      );
    }

    const oldGroup = 'viewer';
    const oldExpire = u.expire_at;
    let newGroup: string;
    let newExpire: string | null;

    if (mode === 'vip') {
      // 保留 viewer 当前 expire_at (用户已买的 vip 时间,可能 NULL = 永久)
      newGroup = 'vip';
      newExpire = oldExpire; // string (ISO) 或 null
    } else {
      // basic = 永久
      newGroup = 'basic';
      newExpire = null;
    }

    // 4. UPDATE
    const updated = await sql`
      UPDATE xx_users
      SET user_group = ${newGroup},
          expire_at = ${newExpire}::timestamptz,
          updated_at = NOW()
      WHERE id = ${userId} AND user_group = 'viewer' AND status = 'active'
      RETURNING id, username, user_group, expire_at::text
    ` as any[];

    if (!updated[0]) {
      return NextResponse.json({ error: 'UPDATE 失败 (并发冲突, 请重试)', code: 'race' }, { status: 409 });
    }

    // 5. 写 xx_lumen_logs (type='admin_activate', description 含旧→新)
    try {
      await sql`
        INSERT INTO xx_lumen_logs (user_id, change_amount, balance_after, type, ref_code, description, created_at)
        VALUES (
          ${userId},
          ${0},
          ${0},
          'admin_activate',
          ${null},
          ${'admin (id=' + adminId + ') 升级 viewer 客户: ' + oldGroup + ' -> ' + newGroup + ', expire_at: ' + (newExpire || 'NULL')},
          NOW()
        )
      `;
    } catch (e: any) {
      // 写日志失败不影响主流程
      console.warn('[admin/activate] xx_lumen_logs write failed:', e.message);
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      username: updated[0].username,
      old_group: oldGroup,
      new_group: updated[0].user_group,
      old_expire_at: oldExpire,
      new_expire_at: updated[0].expire_at,
      message: '✅ 升级成功: ' + u.username + ' (id=' + userId + ') viewer -> ' + newGroup,
    });
  } catch (e: any) {
    console.error('[admin/activate] ERR:', e.message);
    return NextResponse.json({ error: '升级失败: ' + e.message, code: 'db_error' }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }});
}
