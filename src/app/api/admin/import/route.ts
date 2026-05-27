import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function detectSource(link: string): string {
  if (!link) return '115';
  if (link.includes('115.com')) return '115';
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

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const items: any[] = body.items || [];

    if (items.length === 0) {
      return NextResponse.json({ error: '没有数据' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 批量 INSERT，每批最多 500 条，减少数据库往返
    const BATCH = 500;
    let totalImported = 0;
    let totalFailed = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);

      // 构造批量 VALUES 字符串，手动拼接参数
      const cols = 'name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at';
      const vals = batch.map((item, idx) => {
        const offset = i + idx;
        // 每条6个参数: name, link, link_code, source, category, size
        const base = offset * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NULL, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW())`;
      }).join(', ');

      // 收集所有参数值
      const params: any[] = batch.flatMap(item => [
        item.name || '',
        item.link || '',
        item.link_code || '',
        item.source || detectSource(item.link || ''),
        item.category || '其他',
        item.size || '',
      ]);

      try {
        await sql(`INSERT INTO xx_resources (${cols}) VALUES ${vals}`, params);
        totalImported += batch.length;
      } catch (err: any) {
        console.error(`批次失败 (${i / BATCH + 1}):`, err.message);
        totalFailed += batch.length;
      }
    }

    return NextResponse.json({
      success: true,
      imported: totalImported,
      failed: totalFailed,
      total: items.length,
    });
  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}