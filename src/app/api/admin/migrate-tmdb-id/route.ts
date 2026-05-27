import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 解析 name 字段中的 {tmdb-XXX} 标签，写入 tmdb_id，并清理 name
    // 只处理未匹配过的（tmdb_id IS NULL）
    const result = await sql`
      WITH updated AS (
        UPDATE xx_resources
        SET
          tmdb_id = regexp_replace(name, '.*\\{tmdb-(\\d+)\\}.*', '\\1')::text,
          name = regexp_replace(name, '\\s*\\{tmdb-\\d+\\}', '', 'g'),
          updated_at = NOW()
        WHERE
          status = 'active'
          AND tmdb_id IS NULL
          AND name ~ '\\{tmdb-\\d+\\}'
        RETURNING id
      )
      SELECT count(*) as cnt FROM updated
    `;

    return NextResponse.json({
      migrated: (result as any[])[0]?.cnt ?? 0,
      message: '完成',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET 也支持，方便测试
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('key') !== process.env.JWT_SECRET) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  try {
    // 先预览：看看有多少条带 {tmdb-} 标签但 tmdb_id 为空
    const preview = await sql`
      SELECT count(*) as cnt
      FROM xx_resources
      WHERE status = 'active'
        AND tmdb_id IS NULL
        AND name ~ '\\{tmdb-\\d+\\}'
    `;
    return NextResponse.json({ pending: (preview as any[])[0]?.cnt ?? 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}