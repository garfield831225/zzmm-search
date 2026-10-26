// /api/titles/wechat - 公开读取 /titles 页面的微信联系配置
// 2026-10-22: 页面要显示微信号 + 二维码路径, 但不能暴露安全码
//   - 只返 wechat + wechatQr 两个字段
//   - 安全码 (titles_access_code) 绝不出现在这里
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 5;

const KEY_WECHAT = 'titles_wechat';
const KEY_WECHAT_QR = 'titles_wechat_qr';

export async function GET() {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const rows = await sql`
      SELECT key, value FROM xx_system_settings
      WHERE key IN (${KEY_WECHAT}, ${KEY_WECHAT_QR})
    ` as any[];
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value ?? '';
    return NextResponse.json({
      ok: true,
      wechat: map[KEY_WECHAT] || 'HKmaipanren',
      wechatQr: map[KEY_WECHAT_QR] || '/wechat-qr.png',
    });
  } catch (e: any) {
    // DB 读不到也要让页面能显示 (用默认值)
    return NextResponse.json({
      ok: true,
      wechat: 'HKmaipanren',
      wechatQr: '/wechat-qr.png',
    });
  }
}
