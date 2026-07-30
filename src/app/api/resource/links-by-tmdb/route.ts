// 2026-07-31: 新建 - 按 TMDB ID 拿同剧所有 link (按源优先级 + 最新置顶)
// 用途: 详情页 modal 打开时独立 fetch, 不依赖 search 路由
// 鉴权: 跟 search 路由一致 (admin/vip 全部 / basic 限 zezhe 渠道 / other 1=0)
import { NextRequest, NextResponse } from 'next/server';
import { neon, neonConfig } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 修 Vercel warm 状态复用旧 connection (跟 search 路由一致)
neonConfig.fetchConnectionCache = false;

const SOURCE_PRIORITY: Record<string, number> = {
  '115': 1, '115网盘': 1,
  'quark': 2, '夸克网盘': 2,
  'baidu': 3, '百度网盘': 3,
  'ali': 4, 'aliyun': 4, '阿里云盘': 4,
  'magnet': 5, '磁力链接': 5,
  'ed2k': 6, 'ed2k链接': 6,
  'thunder': 7, '迅雷链接': 7,
  'xunlei': 7,
  '123': 8, '123网盘': 8,
  'uc': 9, 'UC网盘': 9,
  'tianyi': 10, '天翼云盘': 10,
  'yidong': 11, '移动云盘': 11,
};

const SOURCE_DISPLAY: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
  'xunlei': '迅雷网盘', 'uc': 'UC网盘', 'yidong': '移动云盘',
  'ali': '阿里云盘',
};

export async function GET(request: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');

  try {
    const { searchParams } = new URL(request.url);
    const tmdbId = (searchParams.get('tmdb_id') || '').trim();
    if (!tmdbId) {
      return NextResponse.json({ error: '缺少 tmdb_id 参数' }, { status: 400 });
    }

    // 预解析 userGroup
    let userGroup: string = 'user';
    try {
      let token: string | null = null;
      const authHeader = request.headers.get('authorization');
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.replace('Bearer ', '');
      } else {
        const cookieToken = request.cookies.get('zzmm_token')?.value;
        if (cookieToken) token = cookieToken;
      }
      if (token) {
        const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
        const userId = String(payload.id);
        userGroup = (payload.group || 'user').toLowerCase();
        const userRow = await sql`SELECT user_group FROM xx_users WHERE id = ${userId} LIMIT 1`;
        if (userRow[0]?.user_group) userGroup = String(userRow[0].user_group).toLowerCase();
      }
    } catch { /* 未登录或无效 token → userGroup='user' */ }

    const isVipPlus = ['vip', 'admin'].includes(userGroup);

    // 1) 拿资源元信息 (不卡 access_level, 详情页要让 basic 也能看 VIP 资源列表, 只是不能点开)
    //    跟 search 路由对齐: 后端不卡 access_level, 前端按 userGroup 显示 VIP 锁
    const metaRows = await sql`
      SELECT id, name, link, link_code, source, category, size, type, tags, tmdb_id, created_at,
             doc_sheet, sub_type, lumen_cost, pay_type, code_price, lumen_cost,
             access_level, access_tier, import_channel, view_count
      FROM xx_resources
      WHERE tmdb_id = ${tmdbId}
        AND link IS NOT NULL AND link != ''
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 500
    ` as any[];

    // 2) 鉴权过滤 (basic 限 zezhe 渠道可见)
    const filtered = (metaRows || []).filter((r: any) => {
      if (isVipPlus) return true;
      const ch = String(r.import_channel || '').toLowerCase();
      return ch === 'zezhe' || ch === 'zezemom_excel';
    });

    // 3) 按 source 优先级 + created_at DESC 排序
    const sorted = [...filtered].sort((a: any, b: any) => {
      const sa = SOURCE_PRIORITY[a.source] || 99;
      const sb = SOURCE_PRIORITY[b.source] || 99;
      if (sa !== sb) return sa - sb;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // 4) 格式化输出
    const links = sorted.map((r: any) => ({
      id: r.id,
      name: r.name || '',
      source: r.source || '',
      sourceDisplay: SOURCE_DISPLAY[r.source] || r.source || '',
      url: r.link,
      password: r.link_code || '',
      size: r.size || '',
      accessLevel: r.access_level || 'basic',
      importChannel: r.import_channel || '',
      payType: r.pay_type || 'free',
      lumenCost: r.lumen_cost ?? 1,
      createdAt: r.created_at,
    }));

    return NextResponse.json({
      tmdbId,
      total: links.length,
      links,
      userGroup,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || '查询失败' }, { status: 500 });
  }
}
