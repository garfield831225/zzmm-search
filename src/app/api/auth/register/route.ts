import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
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

export async function POST(req: NextRequest) {
  try {
    // 限流: 单 IP 每小时最多 5 次注册
    const ip = getClientIp(req.headers);
    const rl = rateLimit(`register:${ip}`, { limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json({ error: '注册太频繁，请 1 小时后再试', code: 'rate_limited', resetIn: Math.ceil(rl.resetIn / 1000) }, { status: 429, headers: CORS_HEADERS });
    }

    // 2026-08-16 viewer-role: 支持两种注册路径
    //   - application_path='main' (默认): 邀请码注册 → basic 基础会员
    //   - application_path='viewer_apply': 文档资源站申请 → viewer 待确认
    const { username, password, captcha, invite_code, application_path, wechat_name, wechat_id, application_reason } = await req.json();
    const isViewerApply = application_path === 'viewer_apply';

    const storedCaptcha = req.cookies.get('captcha_code')?.value || '';
    if (!captcha || !storedCaptcha || captcha.toLowerCase() !== storedCaptcha.toLowerCase()) {
      return NextResponse.json({ error: '验证码错误' }, { status: 400, headers: CORS_HEADERS });
    }

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400, headers: CORS_HEADERS });
    }

    if (username.length < 3 || password.length < 6) {
      return NextResponse.json({ error: '用户名至少3位，密码至少6位' }, { status: 400, headers: CORS_HEADERS });
    }

    // 2026-08-16 viewer 申请要求: 微信号必填
    if (isViewerApply) {
      if (!wechat_name || !wechat_id) {
        return NextResponse.json({ error: '请填写微信号和微信名（用于审核）', code: 'wechat_required' }, { status: 400, headers: CORS_HEADERS });
      }
    } else {
      // 2026-06-25: 必须有有效邀请码
      if (!invite_code || typeof invite_code !== 'string') {
        return NextResponse.json({ error: '请输入邀请码', code: 'invite_required' }, { status: 400, headers: CORS_HEADERS });
      }
    }

    const sql = neon(process.env.DATABASE_URL || '');

    if (!isViewerApply) {
      // 验邀请码 (仅 main 路径)
      const inv = await sql`SELECT id, is_used, expires_at FROM xx_invite_codes WHERE code = ${invite_code.trim().toUpperCase()} LIMIT 1` as any[];
      if (!inv[0]) return NextResponse.json({ error: '邀请码无效', code: 'invalid_invite' }, { status: 400, headers: CORS_HEADERS });
      if (inv[0].is_used) return NextResponse.json({ error: '邀请码已被使用', code: 'invite_used' }, { status: 409, headers: CORS_HEADERS });
      if (inv[0].expires_at && new Date(inv[0].expires_at) < new Date()) {
        return NextResponse.json({ error: '邀请码已过期', code: 'invite_expired' }, { status: 410, headers: CORS_HEADERS });
      }
    }

    // 检查用户名是否已存在
    const exist = await sql`SELECT id FROM xx_users WHERE username = ${username}`;
    if ((exist as any[]).length > 0) {
      return NextResponse.json({ error: '用户名已存在' }, { status: 409, headers: CORS_HEADERS });
    }

    // 加密密码
    const hashed = bcrypt.hashSync(password, 10);

    let user: any;
    if (isViewerApply) {
      // 2026-08-16 viewer 申请路径: viewer 档 + pending 状态
      const result = await sql`
        INSERT INTO xx_users (username, password_hash, user_group, status, registration_source, wechat_name, wechat_id, application_reason, created_at, updated_at)
        VALUES (${username}, ${hashed}, 'viewer', 'pending', 'viewer_apply', ${wechat_name}, ${wechat_id}, ${application_reason || null}, NOW(), NOW())
        RETURNING id, username, user_group, status
      `;
      user = (result as any[])[0];

      // 写 xx_pending_user_applications 详细申请记录 (兼容老 schema, 用 try/catch)
      try {
        await sql`
          INSERT INTO xx_pending_user_applications (user_id, registration_source, application_reason, status, created_at, updated_at)
          VALUES (${user.id}, 'viewer_apply', ${application_reason || null}, 'pending', NOW(), NOW())
        `;
      } catch (e: any) {
        // 表不存在 (migration 没跑) 不阻塞注册
        console.warn('[register viewer] xx_pending_user_applications insert failed (可能 migration 未跑):', e.message);
      }

      // viewer pending 不返 token, 客户端跳 /pending-approval
      return NextResponse.json({
        pending: true,
        user: { id: user.id, username: user.username, user_group: 'viewer', status: 'pending' },
        message: '申请已提交，请等待管理员审核',
      }, { headers: CORS_HEADERS });
    } else {
      // 主路径: 创建用户 (默认 'basic' 基础会员 - 邀请码就是 basic 凭证)
      // 2026-07-29: 用户拍板 - 邀请码 = basic, 不用再强制激活
      // VIP 资源锁住 = 前端展示, basic 也能看所有资源
      // 激活码 = 可选升级 VIP 用
      const result = await sql`
        INSERT INTO xx_users (username, password_hash, user_group, status, created_at, updated_at)
        VALUES (${username}, ${hashed}, 'basic', 'active', NOW(), NOW())
        RETURNING id, username, user_group, expire_at
      `;
      user = (result as any[])[0];

      // 标记邀请码已用
      const inv = await sql`SELECT id FROM xx_invite_codes WHERE code = ${invite_code.trim().toUpperCase()} LIMIT 1` as any[];
      if (inv[0]) {
        await sql`UPDATE xx_invite_codes SET is_used = true, used_by = ${user.id}, used_at = NOW() WHERE id = ${inv[0].id}`;
      }

      // 2026-07-29: 同步初始化 last_login (新用户立刻有 last_login 记录, 单点登录校验)
      await sql`UPDATE xx_users SET last_login = NOW() WHERE id = ${user.id}`;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.user_group },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    return NextResponse.json({
      token,
      user: { id: user.id, username: user.username, group: user.user_group, expire_at: user.expire_at },
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS_HEADERS });
  }
}