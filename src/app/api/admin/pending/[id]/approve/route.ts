// 2026-08-03: P6.2 admin pending 通过审核
//   - POST /api/admin/pending/[id]/approve
//   - 流程:
//     1) 读 pending record (links, type, name, tmdb_id, user_id, size/size_unit/note)
//     2) 算积分 (按 type: 4K原盘/原盘=10, 4K/杜比视界=8, 1080P/720P/REMUX/低分辨率=5)
//     3) INSERT xx_resources (active, 拿 pending.name 作 name, links[0] 作 link)
//     4) UPDATE xx_pending_resources status='approved' + reviewed_at + reviewed_by
//     5) UPSERT xx_user_points +amount
//     6) INSERT xx_point_logs (type='upload_reward', amount, ref_id=pending_id)

import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

neonConfig.fetchConnectionCache = false;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function pointsForType(type: string): number {
  if (type === '4K原盘' || type === '原盘') return 10;
  if (type === '4K' || type === '杜比视界') return 8;
  // 'REMUX' / '1080P' / '720P' / '低分辨率'
  return 5;
}

function typeToCategory(type: string): { category: string; accessLevel: string } {
  if (type === '4K原盘' || type === '原盘' || type === 'REMUX') {
    return { category: type, accessLevel: 'basic' };
  }
  if (type === '4K' || type === '杜比视界') {
    return { category: '电影', accessLevel: 'basic' };
  }
  if (type === '1080P' || type === '720P' || type === '低分辨率') {
    return { category: '电影', accessLevel: 'basic' };
  }
  return { category: '电影', accessLevel: 'basic' };
}

function detectSource(url: string): string {
  if (!url) return 'other';
  if (/magnet:\?xt=urn:btih:/i.test(url)) return 'magnet';
  if (/115\.com|115cdn\.com|anxia\.com/i.test(url)) return '115';
  if (/pan\.baidu\.com|m\.bdurl\.net/i.test(url)) return 'baidu';
  if (/aliyundrive\.com|alipan\.com/i.test(url)) return 'aliyun';
  if (/pan\.quark\.cn/i.test(url)) return 'quark';
  if (/cloud\.189\.cn/i.test(url)) return '189cloud';
  if (/drive\.google\.com/i.test(url)) return 'google';
  return 'other';
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const a = authAdmin(request);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const pendingId = parseInt(params.id);
  if (!pendingId) return NextResponse.json({ error: 'id 错误' }, { status: 400 });

  try {
    const sql = neon(process.env.DATABASE_URL || '', { fetchOptions: { cache: 'no-store' } });

    // 1) 读 pending record
    const pendingRows = await sql`SELECT id, user_id, tmdb_id, name, type, links, status FROM xx_pending_resources WHERE id = ${pendingId}::int`;
    if (pendingRows.length === 0) {
      return NextResponse.json({ error: '找不到该 pending 资源' }, { status: 404 });
    }
    const p = pendingRows[0];
    if (p.status !== 'pending') {
      return NextResponse.json({ error: `该资源已 ${p.status}，不能重复操作` }, { status: 400 });
    }

    const links: string[] = typeof p.links === 'string' ? JSON.parse(p.links) : p.links;
    if (!Array.isArray(links) || links.length === 0) {
      return NextResponse.json({ error: 'links 异常' }, { status: 500 });
    }

    const firstLink = links[0];
    const source = detectSource(firstLink);
    const { category, accessLevel } = typeToCategory(p.type);
    const points = pointsForType(p.type);

    // 2) INSERT xx_resources (1 条对应 1 个 link, 多个 link 用同 name 多次插, 这里先取 links[0])
    // 简化: 只插第 1 条 link (后续可扩展为 1 对 N, 用 xx_resource_links)
    const insertRes = await sql`
      INSERT INTO xx_resources (name, link, link_code, source, category, access_level, status, import_channel, tmdb_id, created_at, updated_at)
      VALUES (${p.name}, ${firstLink}, '', ${source}, ${category}, ${accessLevel}, 'active', 'user_upload', ${p.tmdb_id}::text, NOW(), NOW())
      RETURNING id
    `;
    const newResourceId = insertRes[0].id;

    // 3) UPDATE pending status
    await sql`UPDATE xx_pending_resources SET status = 'approved', reviewed_at = NOW(), reviewed_by = ${a.userId} WHERE id = ${pendingId}::int`;

    // 4) UPSERT xx_user_points (积分独立系统, 跟流明分开!)
    const exist = await sql`SELECT user_id, points FROM xx_user_points WHERE user_id = ${p.user_id}`;
    let newPoints = points;
    if (exist.length === 0) {
      await sql`INSERT INTO xx_user_points (user_id, points, updated_at) VALUES (${p.user_id}, ${points}, NOW())`;
    } else {
      newPoints = exist[0].points + points;
      await sql`UPDATE xx_user_points SET points = points + ${points}, updated_at = NOW() WHERE user_id = ${p.user_id}`;
    }

    // 5) INSERT xx_point_logs (积分流水)
    await sql`
      INSERT INTO xx_point_logs (user_id, type, amount, ref_id, note, created_at)
      VALUES (${p.user_id}, 'upload_reward', ${points}, ${pendingId}::int, ${`上传审核通过: ${p.type} +${points} 积分`}, NOW())
    `;

    return NextResponse.json({
      success: true,
      message: `✅ 已通过, 资源入库 (id=${newResourceId}), +${points} 积分`,
      resourceId: newResourceId,
      points,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
