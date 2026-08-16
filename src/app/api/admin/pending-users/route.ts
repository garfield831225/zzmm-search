// 2026-08-16 viewer-role: 后台待确认注册列表 + 审核 API
// GET: 列出 status='pending' 用户 + 申请详情
// POST: { user_id, action: 'approve' | 'reject', wechat_name, wechat_id, review_note }
//   - approve: user_group='viewer' (已确认), status='active', approved_at=NOW(), approved_by=admin.id
//   - reject: status='banned', reject_reason + review_note 写入
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

neonConfig.fetchConnectionCache = false;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 鉴权 admin
function getAdmin(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET) as any;
    if (String(payload.group || '').toLowerCase() !== 'admin') return null;
    return { id: Number(payload.id), username: String(payload.username || '') };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const admin = getAdmin(req);
  if (!admin) return NextResponse.json({ error: '需要 admin 权限' }, { status: 401 });

  const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });
  // 2026-08-16: 列 status='pending' 用户 + 申请详情
  // LEFT JOIN xx_pending_user_applications 容错 (migration 没跑就当空)
  const rows = await sql`
    SELECT u.id, u.username, u.user_group, u.status, u.registration_source,
           u.wechat_name, u.wechat_id, u.application_reason, u.created_at::text as created_at,
           u.reject_reason,
           a.application_reason as app_reason_detail,
           a.contact_info as app_contact,
           a.review_note as app_review_note,
           a.reviewed_by as app_reviewed_by,
           a.reviewed_at::text as app_reviewed_at
    FROM xx_users u
    LEFT JOIN xx_pending_user_applications a ON a.user_id = u.id
    WHERE u.status = 'pending'
    ORDER BY u.created_at DESC
    LIMIT 200
  ` as any[];

  return NextResponse.json({
    total: rows.length,
    items: rows.map(r => ({
      id: r.id,
      username: r.username,
      user_group: r.user_group,
      status: r.status,
      registration_source: r.registration_source,
      wechat_name: r.wechat_name || null,
      wechat_id: r.wechat_id || null,
      application_reason: r.application_reason || r.app_reason_detail || null,
      reject_reason: r.reject_reason || null,
      review_note: r.app_review_note || null,
      reviewed_by: r.app_reviewed_by || null,
      reviewed_at: r.app_reviewed_at || null,
      created_at: r.created_at,
    })),
  });
}

export async function POST(req: NextRequest) {
  const admin = getAdmin(req);
  if (!admin) return NextResponse.json({ error: '需要 admin 权限' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { user_id, action, wechat_name, wechat_id, review_note } = body;
  if (!user_id || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

  if (action === 'approve') {
    // 2026-08-16: 审核通过
    //   - wechat_name 作为用户昵称存到 user.username (如果原 username 是空)
    //   - 或者附加到 username: "wechat_name-username"
    //   - 实际: 不改 username, 保留原值 (用户可能想用自己取的 ID)
    //   - wechat_name/wechat_id 已经在注册时存了, 不用重复
    //   - 这里只需要: user_group='viewer', status='active', approved_at, approved_by
    const result = await sql`
      UPDATE xx_users
      SET user_group = 'viewer',
          status = 'active',
          approved_at = NOW(),
          approved_by = ${admin.id},
          wechat_name = COALESCE(${wechat_name || null}, wechat_name),
          wechat_id = COALESCE(${wechat_id || null}, wechat_id)
      WHERE id = ${user_id} AND status = 'pending'
      RETURNING id, username, user_group, status
    ` as any[];

    if (!result.length) {
      return NextResponse.json({ error: '用户不存在或已处理' }, { status: 404 });
    }

    // 同步更新 xx_pending_user_applications (容错, migration 没跑就 warn)
    try {
      await sql`
        UPDATE xx_pending_user_applications
        SET status = 'approved', reviewed_by = ${admin.id}, reviewed_at = NOW(), review_note = ${review_note || null}, updated_at = NOW()
        WHERE user_id = ${user_id}
      `;
    } catch (e: any) {
      console.warn('[approve] xx_pending_user_applications update failed (可能 migration 未跑):', e.message);
    }

    return NextResponse.json({
      success: true,
      action: 'approve',
      user: result[0],
    });
  } else {
    // 2026-08-16: 审核拒绝 → 封号
    const result = await sql`
      UPDATE xx_users
      SET status = 'banned',
          reject_reason = ${review_note || '未通过审核'},
          updated_at = NOW()
      WHERE id = ${user_id} AND status = 'pending'
      RETURNING id, username
    ` as any[];

    if (!result.length) {
      return NextResponse.json({ error: '用户不存在或已处理' }, { status: 404 });
    }

    try {
      await sql`
        UPDATE xx_pending_user_applications
        SET status = 'rejected', reviewed_by = ${admin.id}, reviewed_at = NOW(), review_note = ${review_note || null}, updated_at = NOW()
        WHERE user_id = ${user_id}
      `;
    } catch (e: any) {
      console.warn('[reject] xx_pending_user_applications update failed (可能 migration 未跑):', e.message);
    }

    return NextResponse.json({
      success: true,
      action: 'reject',
      user: result[0],
    });
  }
}
