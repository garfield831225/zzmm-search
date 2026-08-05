// 2026-08-03: P6.2 admin pending 通过审核
// 2026-08-05: 权限规则 (用户拍板)
//   - admin/user 审核通过: 默认 vip 专属 (access_tier='vip', lumen_cost=0, vip + admin 能看, basic 不能看)
//   - 如果同 tmdb_id 有 zezemom_excel / zezhe 已存在 (basic 文档) → 复用, 不新增 basic
//   - 如果没有 zezemom 资源 → 新增一条 basic 链接 (access_tier='document', import_channel='zezhe_baseline') 保留"金标准"
//   - 简化: 只插第 1 条 link (后续可扩展为 1 对 N, 用 xx_resource_links)

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

    // 1) 读 pending record + JOIN xx_upcoming 拿 tmdb_type ('tv'|'movie') — user_upload 缺这字段会 0 命中
    const pendingRows = await sql`
      SELECT p.id, p.user_id, p.tmdb_id, p.name, p.type, p.links, p.size, p.size_unit, p.status,
             u.tmdb_type
      FROM xx_pending_resources p
      LEFT JOIN xx_upcoming u ON u.tmdb_id = p.tmdb_id
      WHERE p.id = ${pendingId}::int
    `;
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
    // 2026-08-05: 补齐 4 个字段 — 不然 /api/tmdb-resources 查不到这条 (type=NULL) 或 basic 看不到 (access_tier='free')
    const tmdbType = (p as any).tmdb_type || 'movie';  // fallback 'movie' 防 pending 没匹配 upcoming
    const sizeText = p.size != null ? `${p.size} ${p.size_unit || 'GB'}` : null;

    // 2) 检测: 同 tmdb_id + type 下是否已有 zezemom_excel / zezhe (basic 文档)
    const zezemomRows = await sql`
      SELECT id FROM xx_resources
      WHERE tmdb_id = ${String(p.tmdb_id)} AND type = ${tmdbType}
        AND import_channel IN ('zezhe', 'zezemom_excel')
        AND status = 'active'
      LIMIT 1
    `;
    const hasZezemom = zezemomRows.length > 0;

    // 3) INSERT xx_resources (vip 链接)
    // 必传: type, access_tier='vip'(vip+admin 可见), lumen_cost=0(免费), size
    const insertRes = await sql`
      INSERT INTO xx_resources (
        name, link, link_code, source, category, access_level,
        status, import_channel, tmdb_id,
        type, access_tier, lumen_cost, size,
        created_at, updated_at
      )
      VALUES (
        ${p.name}, ${firstLink}, '', ${source}, ${category}, ${accessLevel},
        'active', 'user_upload', ${String(p.tmdb_id)},
        ${tmdbType}, 'vip', 0, ${sizeText},
        NOW(), NOW()
      )
      RETURNING id
    `;
    const newResourceId = insertRes[0].id;

    // 4) 新增一条 basic 链接 (仅在 zezemom 同资源不存在时)
    // 业务规则 (2026-08-05): 保留 vip 链接 + 新增 basic 链接 → basic 用户也能直接看
    let basicResourceId: number | null = null;
    if (!hasZezemom) {
      const basicRes = await sql`
        INSERT INTO xx_resources (
          name, link, link_code, source, category, access_level,
          status, import_channel, tmdb_id,
          type, access_tier, lumen_cost, size,
          created_at, updated_at
        )
        VALUES (
          ${p.name}, ${firstLink}, '', ${source}, ${category}, 'basic',
          'active', 'zezhe_baseline', ${String(p.tmdb_id)},
          ${tmdbType}, 'document', 0, ${sizeText},
          NOW(), NOW()
        )
        RETURNING id
      `;
      basicResourceId = basicRes[0]?.id || null;
    }

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
      message: hasZezemom
        ? `✅ 已通过, vip 链接入库 (id=${newResourceId})${hasZezemom ? ', zezemom 已有 basic 资源复用' : ''}, +${points} 积分`
        : `✅ 已通过, vip + basic 双入库 (vip id=${newResourceId}, basic id=${basicResourceId}), +${points} 积分`,
      resourceId: newResourceId,
      basicResourceId,
      hasZezemom,
      points,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message?.slice(0, 200) }, { status: 500 });
  }
}
