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

  // 干扰线 - 浅灰色
  const lines = Array.from({ length: 6 }, () => {
    const x1 = Math.random() * 120;
    const y1 = Math.random() * 40;
    const x2 = Math.random() * 120;
    const y2 = Math.random() * 40;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#666666" stroke-width="1.5" opacity="0.6"/>`;
  }).join('');

  // 噪点 - 灰色小点
  const dots = Array.from({ length: 15 }, () => {
    const x = Math.random() * 120;
    const y = Math.random() * 40;
    return `<circle cx="${x}" cy="${y}" r="1" fill="#555555" opacity="0.4"/>`;
  }).join('');

  // 字母 - 纯白+微旋转
  const letters = code.split('').map((c, i) => {
    const x = 16 + i * 27;
    const y = 28 + (Math.random() - 0.5) * 6;
    const rotate = (Math.random() - 0.5) * 25;
    return `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" transform="rotate(${rotate}, ${x}, ${y})">${c}</text>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40">
  <rect width="120" height="40" fill="#1a1a2e" rx="6"/>
  ${lines}
  ${dots}
  ${letters}
</svg>`;

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}