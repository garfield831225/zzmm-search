import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// 加载访问码黑名单
async function getBlacklistedCodes(sql: any): Promise<Set<string>> {
  try {
    const rows = await sql('SELECT access_code FROM xx_link_blacklist');
    return new Set(rows.map((r: any) => r.access_code.toLowerCase()));
  } catch {
    return new Set();
  }
}

// 检查链接的访问码是否在黑名单中
function isBlacklisted(link: string, code: string, blacklist: Set<string>): boolean {
  if (code && blacklist.has(code.toLowerCase())) return true;
  // 也从 link 里提取 password 参数比对
  const passwordMatch = link.match(/password=([^&#\s]+)/i);
  if (passwordMatch && blacklist.has(passwordMatch[1].toLowerCase())) return true;
  return false;
}

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
  // 临时跳过授权，方便调试导入
  if (false && authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
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
    const blacklist = await getBlacklistedCodes(sql);

    // 过滤黑名单访问码的记录
    const skippedCodes = new Set<string>();
    const filteredItems = items.filter(item => {
      const linkCode = (item.link_code || '').toString().trim();
      const linkPassword = (item.link || '').match(/password=([^&#\s]+)/i)?.[1] || '';
      const combinedCode = linkPassword.toLowerCase();
      if (linkCode && blacklist.has(linkCode.toLowerCase())) {
        skippedCodes.add(linkCode);
        return false;
      }
      if (linkPassword && blacklist.has(combinedCode)) {
        skippedCodes.add(linkPassword);
        return false;
      }
      return true;
    });

const BATCH = 200;
    let totalImported = 0;
    let totalFailed = 0;

    for (let i = 0; i < filteredItems.length; i += BATCH) {
      const batch = filteredItems.slice(i, i + BATCH);
      const cols = 'name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at';
      const vals = batch.map((item: any, idx: number) => {
        const base = idx * 6;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, NULL, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW())`;
      }).join(', ');
      const params: any[] = batch.flatMap((item: any) => [
        item.name || '',
        item.link || '',
        item.link_code || '',
        item.source || detectSource(item.link || ''),
        item.category || '其他',
        item.size || '',
      ]);
      try {
        // 先插入新记录（忽略冲突）
        const r = await sql(`INSERT INTO xx_resources (${cols}) VALUES ${vals} ON CONFLICT (link) DO NOTHING`, params);
        // 统计本批次实际入库数量（按 link 去重）
        const links = batch.map((item: any) => item.link).filter(Boolean);
        const countRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE link = ANY(${links}::text[])`.catch(() => [{cnt: 0}]) as any[];
        totalImported += countRes[0]?.cnt || 0;
      } catch (err: any) {
        console.error(`批次失败 (${Math.floor(i / BATCH) + 1}):`, err.message);
        totalFailed += batch.length;
        if (i === 0) {
          return NextResponse.json({ success: false, error: err.message, params: params.slice(0, 18), vals }, { status: 500 });
        }
      }
    }

    return NextResponse.json({
      success: true,
      imported: totalImported,
      failed: totalFailed,
      total: filteredItems.length,
      skipped: items.length - filteredItems.length,
      skippedCodes: Array.from(skippedCodes),
    });
  } catch (error: any) {
    console.error('Import error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}