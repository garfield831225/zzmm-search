// 返回 search API 关键 SQL 段源码 (看 Vercel 上跑的是哪个版本)
import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });

  try {
    // 读 search/route.ts 源码
    const cwd = process.cwd();
    const paths = [
      join(cwd, 'src/app/api/search/route.ts'),
      join(cwd, '.next/server/app/api/search/route.js'),
      join(cwd, '.next/server/chunks'),
    ];
    const fileList = paths.map(p => ({ path: p, exists: require('fs').existsSync(p) }));
    return NextResponse.json({ cwd, fileList });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
