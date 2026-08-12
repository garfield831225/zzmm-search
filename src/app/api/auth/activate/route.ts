// 2026-08-13: 公共 API (moviezone + 子站) - /api/auth/activate 别名
//   实际逻辑在 /api/user/activate (zzmm-search 原有), 这里只做转发 + 加 CORS 头
//   错误格式保持原样 {error: 'string', code?: 'xxx'} (跟 /api/user/activate 一致)
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function jsonWithCors(body: any, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers as any || {}) } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// 重新导出 POST handler, 行为完全一致, 不引入额外逻辑
export { POST } from '../../user/activate/route';
