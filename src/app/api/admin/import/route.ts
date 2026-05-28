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

// 飞书文档数据解析
async function fetchFeishuDoc(docUrl: string): Promise<any[]> {
  // 从 URL 提取文档 token
  // 格式: https://xxx.feishu.cn/docx/xxx 或 https://xxx.feishu.cn/docs/xxx
  const match = docUrl.match(/(docx|docs)\/([A-Za-z0-9]+)/);
  if (!match) throw new Error('无法解析飞书文档 URL');

  const token = match[2];
  const docToken = process.env.FEISHU_DOC_TOKEN;
  const appToken = process.env.FEISHU_APP_TOKEN;

  if (!docToken && !appToken) {
    // fallback: 尝试通过网页抓取（简单模式）
    try {
      const res = await fetch(docUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const html = await res.text();
      // 简单解析：提取表格数据（飞书文档表格内容）
      const items: any[] = [];
      // 从 HTML 中尝试提取结构化数据
      const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi);
      if (tableMatch) {
        // 解析表格逻辑
      }
      return items;
    } catch {
      throw new Error('飞书文档拉取失败，请检查文档是否公开');
    }
  }

  // 使用飞书 API 获取文档内容
  const apiUrl = `https://open.feishu.cn/open-apis/docx/v1/documents/${token}`;
  const resp = await fetch(apiUrl, {
    headers: {
      'Authorization': `Bearer ${docToken || appToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!resp.ok) throw new Error(`飞书 API 错误: ${resp.status}`);
  const data = await resp.json();
  if (data.code !== 0) throw new Error(`飞书错误: ${data.msg}`);

  // 解析文档块获取表格数据
  // 此处简化处理，实际需要递归解析 docx blocks
  return [];
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const mode: string = body.mode || 'standard';

    // 飞书文档模式
    if (mode === 'doc') {
      const docUrl = body.docUrl;
      if (!docUrl) return NextResponse.json({ error: '缺少文档地址' }, { status: 400 });

      try {
        const items = await fetchFeishuDoc(docUrl);
        if (!items.length) return NextResponse.json({ error: '文档中未找到有效数据' }, { status: 400 });

        const sql = neon(process.env.DATABASE_URL || '');
        const BATCH = 500;
        let totalImported = 0;
        let totalFailed = 0;

        for (let i = 0; i < items.length; i += BATCH) {
          const batch = items.slice(i, i + BATCH);
          const cols = 'name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at';
          const vals = batch.map((item, idx) => {
            const offset = i + idx;
            const base = offset * 6;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NULL, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW())`;
          }).join(', ');
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
          } catch {
            totalFailed += batch.length;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        return NextResponse.json({ success: true, imported: totalImported, failed: totalFailed, total: items.length });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
      }
    }

    // 标准 / 泽泽妈妈 模式（批量数据）
    const items: any[] = body.items || [];
    if (items.length === 0) {
      return NextResponse.json({ error: '没有数据' }, { status: 400 });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    const BATCH = 500;
    let totalImported = 0;
    let totalFailed = 0;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const cols = 'name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at';
      const vals = batch.map((item, idx) => {
        const offset = i + idx;
        const base = offset * 6;
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NULL, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW())`;
      }).join(', ');
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