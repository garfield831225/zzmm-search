// /api/admin/titles-settings - /titles 访问码 + 微信配置 读写 (admin)
// 2026-10-22: 安全码存 xx_system_settings, 后台可改, 改完立刻生效 (不用发版)
//   GET  → 读当前安全码 (admin 才能看明文) + 微信配置
//   POST → 改安全码 / 微信联系方式 / 二维码路径
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const KEY_ACCESS_CODE = 'titles_access_code';
const KEY_WECHAT = 'titles_wechat';
const KEY_WECHAT_QR = 'titles_wechat_qr';

export async function GET(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) {
    return NextResponse.json({ error: a.error }, { status: a.status });
  }
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`
      SELECT key, value, description, updated_at
      FROM xx_system_settings
      WHERE key IN (${KEY_ACCESS_CODE}, ${KEY_WECHAT}, ${KEY_WECHAT_QR})
    ` as any[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ?? '';
    return NextResponse.json({
      success: true,
      accessCode: map[KEY_ACCESS_CODE] || '2015',
      wechat: map[KEY_WECHAT] || 'HKmaipanren',
      wechatQr: map[KEY_WECHAT_QR] || '/wechat-qr.png',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const a = authAdmin(request);
  if (a.error) {
    return NextResponse.json({ error: a.error }, { status: a.status });
  }
  try {
    const body = await request.json().catch(() => ({}));
    const sql = neon(process.env.DATABASE_URL || '');

    // 改安全码: 必须是 4 位数字
    if (body.accessCode !== undefined) {
      const code = String(body.accessCode).trim();
      if (!/^\d{4}$/.test(code)) {
        return NextResponse.json({ error: '安全码必须是 4 位数字' }, { status: 400 });
      }
      await sql`
        INSERT INTO xx_system_settings (key, value, description, updated_at)
        VALUES (${KEY_ACCESS_CODE}, ${code}, '/titles 访问码 (4位数字, 登录前输入)', NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    }

    // 改微信联系方式
    if (body.wechat !== undefined) {
      const w = String(body.wechat).trim();
      if (!w) return NextResponse.json({ error: '微信号不能为空' }, { status: 400 });
      await sql`
        INSERT INTO xx_system_settings (key, value, description, updated_at)
        VALUES (${KEY_WECHAT}, ${w}, '/titles 页面显示的微信联系方式', NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    }

    // 改二维码路径
    if (body.wechatQr !== undefined) {
      const q = String(body.wechatQr).trim();
      if (!q.startsWith('/')) {
        return NextResponse.json({ error: '二维码路径必须以 / 开头' }, { status: 400 });
      }
      await sql`
        INSERT INTO xx_system_settings (key, value, description, updated_at)
        VALUES (${KEY_WECHAT_QR}, ${q}, '/titles 页面显示的微信二维码图片路径', NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    }

    return NextResponse.json({ success: true, message: '已保存, 立即生效' });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
