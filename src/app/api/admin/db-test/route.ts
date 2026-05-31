import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const key = req.nextUrl.searchParams.get('key');
    if (key !== '5ef64fef249935a70a9fd9ae4bf34a3790aacb260618af3e3b49381ea14a4606') {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    // 查表结构
    const cols = await sql`SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'xx_resources' ORDER BY ordinal_position`.catch(() => []) as any[];

    // 查 xx_resources 行数
    const cnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources`.catch(() => [{cnt: -1}]) as any[];

    // 尝试简单插入测试
    let insertTest = 'not run';
    try {
      const r = await sql`INSERT INTO xx_resources (name, link, link_code, source, category, size, status, valid_status, view_count, created_at, updated_at) VALUES ('test_mavis_debug', 'https://115.com/s/test999', '', '115', '电影', '0', 'active', 'unchecked', 0, NOW(), NOW()) RETURNING id`.catch(() => []) as any[];
      insertTest = r?.length ? `inserted id=${r[0].id}` : 'inserted no return';
    } catch (err: any) {
      insertTest = `insert failed: ${err.message}`;
    }

    return NextResponse.json({ cols, count: cnt[0]?.cnt, insertTest });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}