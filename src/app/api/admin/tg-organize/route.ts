// /api/admin/tg-organize - zzmm-search 端 TG SaaS 集成
// 调 NAS tg-saas:58080 上传 TG 群导出, 解析链接, 入库候选
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // TG SaaS 上传可能慢

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const TG_SAAS_URL = process.env.TG_SAAS_URL || 'http://192.168.1.100:58080'; // NAS 部署

// 鉴权: admin / vip 才用
function getUser(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.replace('Bearer ', '') : '';
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET) as any;
  } catch { return null; }
}

async function isVipOrAdmin(sql: any, userId: number): Promise<boolean> {
  const r = await sql`SELECT user_group, expire_at FROM xx_users WHERE id = ${userId} LIMIT 1` as any[];
  if (!r[0]) return false;
  const u = r[0];
  return (u.user_group === 'vip' || u.user_group === 'admin') && (!u.expire_at || new Date(u.expire_at) > new Date());
}

// 上传 TG 群导出文件到 TG SaaS
// POST /api/admin/tg-organize
// formData: files (TG 导出 HTML/JSON, 多文件)
// 查询参数: type_filter (movie/tv/...)
export async function POST(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const sql = neon(process.env.DATABASE_URL || '');
  if (!(await isVipOrAdmin(sql, Number(user.id)))) {
    return NextResponse.json({ error: '需要 VIP 会员' }, { status: 403 });
  }

  // 解析 multipart (TG SaaS /api/data/upload 接受 files 数组)
  const form = await req.formData();
  const files = form.getAll('files') as File[];
  const typeFilter = (form.get('type_filter') as string) || '';
  if (!files.length) return NextResponse.json({ error: '请上传文件' }, { status: 400 });

  // 转 formData 给 TG SaaS
  const tgForm = new FormData();
  for (const f of files) {
    tgForm.append('files', f, f.name);
  }

  // 调 TG SaaS 上传
  const tgUrl = `${TG_SAAS_URL}/api/data/upload`;
  let tgRes: Response;
  try {
    tgRes = await fetch(tgUrl, {
      method: 'POST',
      body: tgForm,
      // 不带 Content-Type, 让 fetch 自动设 multipart boundary
      signal: AbortSignal.timeout(55000),
    });
  } catch (e: any) {
    return NextResponse.json({ error: 'TG SaaS 不可达: ' + (e.message || 'unknown') }, { status: 502 });
  }
  if (!tgRes.ok) {
    return NextResponse.json({ error: 'TG SaaS 上传失败: HTTP ' + tgRes.status }, { status: 502 });
  }
  const tgData = await tgRes.json();
  // TG SaaS 响应: { success, count, items: [{ id, title, type, source, ... }] }
  if (!tgData.success) {
    return NextResponse.json({ error: 'TG SaaS 上传失败: ' + (tgData.error || 'unknown') }, { status: 502 });
  }

  // 把 TG SaaS 数据入 zzmm-search 候选库 xx_import_candidates
  const items = tgData.items || [];
  let imported = 0;
  for (const it of items) {
    if (typeFilter && it.type !== typeFilter) continue;
    try {
      await sql`
        INSERT INTO xx_import_candidates (
          title, type, source, source_id, raw_data, status, uploaded_by, created_at
        ) VALUES (
          ${it.title || '未命名'}, ${it.type || 'other'}, 'tg-saas',
          ${String(it.id || '')}, ${JSON.stringify(it)},
          'pending', ${user.id}, NOW()
        )
        ON CONFLICT (source, source_id) DO UPDATE SET
          title = EXCLUDED.title, raw_data = EXCLUDED.raw_data, updated_at = NOW()
      `;
      imported++;
    } catch (e: any) {
      console.error('[tg-organize] insert fail:', e.message);
    }
  }

  return NextResponse.json({
    ok: true,
    tg_saas_count: items.length,
    imported,
    type_filter: typeFilter,
    note: '候选已入库, 待 admin 审核后正式入 xx_resources',
  });
}

// 查询候选库列表
export async function GET(req: NextRequest) {
  const user = getUser(req);
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const sql = neon(process.env.DATABASE_URL || '');
  if (!(await isVipOrAdmin(sql, Number(user.id)))) {
    return NextResponse.json({ error: '需要 VIP 会员' }, { status: 403 });
  }
  const status = req.nextUrl.searchParams.get('status') || 'pending';
  const r = await sql`SELECT id, title, type, source, source_id, status, created_at
                      FROM xx_import_candidates
                      WHERE status = ${status}
                      ORDER BY created_at DESC LIMIT 50` as any[];
  return NextResponse.json({ ok: true, items: r, count: r.length });
}
