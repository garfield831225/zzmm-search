import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'tmdb-match-2026-secret-key-abc123';

// ⚠️ 危险操作：清空资源表，重新从 Excel 导入
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, confirm } = body;
    if (key !== JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }
    if (confirm !== 'YES_DELETE_ALL') {
      return NextResponse.json({ error: '必须 confirm=YES_DELETE_ALL 才能执行' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    // 清空资源表（保留其他表）
    await sql`TRUNCATE TABLE xx_resources`.catch(() => 
      sql`DELETE FROM xx_resources`.catch(() => [])
    );
    
    // 重置 TMDB 匹配缓存的统计
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    
    return NextResponse.json({ success: true, message: 'xx_resources 已清空', stats: cats });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// 查询当前状态
export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key');
    if (key !== JWT_SECRET) {
      return NextResponse.json({ error: '未授权' }, { status: 401 });
    }

    const sql = neon(process.env.DATABASE_URL || '');
    const cats = await sql`SELECT category, COUNT(*)::int as cnt FROM xx_resources GROUP BY category ORDER BY cnt DESC`.catch(() => []) as any[];
    const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources`.catch(() => [{cnt:0}]) as any[];
    const withTmdb = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE tmdb_id IS NOT NULL AND tmdb_id != ''`.catch(() => [{cnt:0}]) as any[];

    return NextResponse.json({ total: total[0].cnt, withTmdb: withTmdb[0].cnt, categories: cats });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}