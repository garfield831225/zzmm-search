import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');

  const cookieStore = await cookies();
  cookieStore.set('captcha_code', code.toLowerCase(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 300,
    path: '/',
  });

  // 2026-07-14 修法 B: 字符更清晰
  // 1) 干扰线 6 → 2, 透明度 0.6 → 0.25, 颜色 #666 → #444 (更淡, 不抢字符)
  // 2) 噪点 15 → 6, 透明度 0.4 → 0.3
  // 3) 字符旋转 ±12.5° → 0° (不旋转, 减少误读)
  // 4) 字符间距 27 → 30 (加宽, 避免重叠)
  // 5) 字体 24 → 26 (更大)
  const lines = Array.from({ length: 2 }, () => {
    const x1 = Math.random() * 120;
    const y1 = Math.random() * 40;
    const x2 = Math.random() * 120;
    const y2 = Math.random() * 40;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#444444" stroke-width="1" opacity="0.25"/>`;
  }).join('');

  const dots = Array.from({ length: 6 }, () => {
    const x = Math.random() * 120;
    const y = Math.random() * 40;
    return `<circle cx="${x}" cy="${y}" r="1" fill="#555555" opacity="0.3"/>`;
  }).join('');

  // 字符: 不旋转, y 略小波动, 字体更大, 间距更宽
  const letters = code.split('').map((c, i) => {
    const x = 15 + i * 30;
    const y = 30 + (Math.random() - 0.5) * 2;  // 上下微调 ±1px
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff">${c}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="130" height="40">
  <rect width="130" height="40" fill="#1a1a2e" rx="6"/>
  ${lines}
  ${dots}
  ${letters}
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}
