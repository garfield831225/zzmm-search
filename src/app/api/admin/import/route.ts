export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL!);

    const body = await request.json();
    const items = body.items || [];

    if (items.length === 0) {
      return NextResponse.json({ error: '没有数据' }, { status: 400 });
    }

    console.log(`开始导入 ${items.length} 条数据...`);

    const BATCH = 200;
    let imported = 0;
    let failed = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const values = batch.map((item: any) => {
        const name = (item.name || '').replace(/'/g, "''");
        const link = (item.link || '').replace(/'/g, "''");
        const linkCode = (item.link_code || '').replace(/'/g, "''");
        const size = (item.size || '').replace(/'/g, "''");
        const category = (item.category || '其他').replace(/'/g, "''");
        const source = item.source || detectSource(item.link || '');
        return `(DEFAULT, '${name}', '${link}', '${linkCode}', '${source}', '${category}', '${size}', NULL, '{}', NULL, NULL, 'active', 'unchecked', NULL, NULL, NULL, NULL, 0, NOW(), NOW())`;
      });

      const insertSql = `INSERT INTO xx_resources (id, name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, valid_checked_at, uploaded_by, approved_by, approved_at, view_count, created_at, updated_at) VALUES ${values.join(',')}`;
      
      try {
        await (sql as any).query(insertSql);
        imported += batch.length;
      } catch (err: any) {
        console.error(`批次 ${i / BATCH + 1} 失败:`, err.message);
        failed += batch.length;
      }
    }

    return NextResponse.json({ success: true, imported, failed, total: items.length });
  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { neon } = await import('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL!);
    const result = await sql`SELECT COUNT(*) as count FROM xx_resources`;
    return NextResponse.json({
      total: Number((result as any)[0]?.count || 0),
      message: 'POST JSON数据到 /api/admin/import 进行导入',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

function detectSource(link: string): string {
  if (!link) return '115';
  if (link.includes('115.com') || link.includes('115.cn')) return '115';
  if (link.includes('pan.baidu.com')) return 'baidu';
  if (link.includes('quark.cn')) return 'quark';
  if (link.includes('aliyundrive.com')) return 'aliyun';
  if (link.includes('123pan.com')) return '123';
  if (link.includes('cloud.189.cn')) return 'tianyi';
  if (link.includes('magnet:')) return 'magnet';
  if (link.includes('ed2k://')) return 'ed2k';
  if (link.includes('thunder:') || link.includes('xunlei')) return 'thunder';
  return '115';
}
