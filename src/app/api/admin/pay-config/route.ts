// 2026-07-28: pay-config 增强版
// 1. 搜索: 加 ?q + ?doc_sheet (按 21-sheet 库的 sheet 名筛)
// 2. 返回: 加 doc_sheet, doc_sheet, lumen_cost, access_level, import_channel 字段
// 3. 设置: 支持 pay_type + lumen_cost + code_price 三者独立更新
// 4. 设置 pay_type='code' 时自动同步 access_level='code' (前端过滤双轨)
// 5. doc_sheet 列表: /api/admin/pay-config/sheets
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function esc(s: string) { return String(s).replace(/'/g, "''"); }

export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const payType = searchParams.get('pay_type') || '';
  const docSheet = (searchParams.get('doc_sheet') || '').trim();
  const channel = (searchParams.get('channel') || '').trim();
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
  const offset = (page - 1) * pageSize;

  try {
    // 2026-07-28: 多条件组合
    const conds: string[] = [];
    const condVals: any[] = [];
    const addCond = (condSQL: string, ...vals: any[]) => {
      const offset = condVals.length;
      const renum = condSQL.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      conds.push(renum);
      condVals.push(...vals);
    };
    addCond('r.status = $1', 'active');
    if (q) addCond('(r.name ILIKE $1 OR r.id::text = $1)', `%${q}%`);
    // 2026-08-16: payType='paid' 包含 code + lumen 两种 (都是需要付费的资源)
    if (payType === 'paid') {
      addCond("r.pay_type IN ($1, $2)", 'code', 'lumen');
    } else if (payType) {
      addCond('r.pay_type = $1', payType);
    }
    if (docSheet) addCond('r.doc_sheet = $1', docSheet);
    if (channel) addCond('r.import_channel = $1', channel);
    const whereSQL = 'WHERE ' + conds.join(' AND ');

    const cnt = await sql(`SELECT COUNT(*) as cnt FROM xx_resources r ${whereSQL}`, condVals) as any[];
    const total = parseInt(cnt?.[0]?.cnt || '0');

    const limitPh = `$${condVals.length + 1}`;
    const offsetPh = `$${condVals.length + 2}`;
    const rows = await sql(`
      SELECT r.id, r.name, r.category, r.doc_sheet, r.pay_type, r.code_price, r.lumen_cost,
             r.access_level, r.import_channel, r.source, r.tmdb_id, r.size, r.sub_type, r.created_at,
             COALESCE(c.poster_path, '') as poster_path
      FROM xx_resources r
      LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
      ${whereSQL}
      ORDER BY r.id DESC
      LIMIT ${limitPh} OFFSET ${offsetPh}
    `, [...condVals, pageSize, offset]) as any[];

    return NextResponse.json({
      items: rows,
      total,
      page,
      pageSize,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // 2026-07-28: 增强 - 支持独立设置 pay_type / code_price / lumen_cost
  // 2026-08-16: 加 mode='create' 支持新增资源 (admin 手动发布单资源付费)
  //   pay_type='lumen' 也允许 (单条流明扣减, 无需激活码)
  //   设 pay_type='code' 时自动同步 access_level='code'
  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const { id, pay_type, code_price, lumen_cost, mode } = body;

  // ============ 2026-08-16: 创建新资源 ============
  if (mode === 'create') {
    const { name, category, sub_type, size, link, description, code_price: cp, pay_type: pt, lumen_cost: lc } = body;
    if (!name || !category || !sub_type || !link || !pt) {
      return NextResponse.json({ error: '缺少必填: name/category/sub_type/link/pay_type' }, { status: 400 });
    }
    const validCats = ['电影', '剧集', '动漫', '纪录片', '综艺', '演唱会', '连载', '原盘', 'REMUX', '系列电影', '合集', '音乐', '体育', '电子书', '其他'];
    if (!validCats.includes(category)) {
      return NextResponse.json({ error: `category 必须是: ${validCats.join('/')}` }, { status: 400 });
    }
    if (!['free', 'lumen', 'code'].includes(pt)) {
      return NextResponse.json({ error: 'pay_type 必须是 free/lumen/code' }, { status: 400 });
    }
    const lumen = pt === 'lumen' ? Number(lc || 1) : (lc ? Number(lc) : 1);
    if (!Number.isInteger(lumen) || lumen < 1 || lumen > 100) {
      return NextResponse.json({ error: 'lumen_cost 必须是 1-100 整数 (A 方案: 1-100 手填)' }, { status: 400 });
    }
    const price = pt === 'code' ? Number(cp || 0) : 0;
    if (pt === 'code' && (isNaN(price) || price < 0 || price > 9999)) {
      return NextResponse.json({ error: 'code_price 必须是 0-9999' }, { status: 400 });
    }

    try {
      // 2026-08-16: admin 手动发布, 默认隐藏链接 (status='active', access_level 跟 pay_type 走)
      //   pay_type='code' → access_level='code' (现有 21-sheet 资源兼容)
      //   pay_type='lumen' → access_level='basic' (basic/vip 都能流明解锁, 不锁)
      //   pay_type='free'  → access_level='basic'
      //   备注/详情: 存到 tags (text[]), 用 postgres ARRAY 字面量
      const accessLevel = pt === 'code' ? 'code' : 'basic';
      const tagArr = description ? [String(description).slice(0, 500)] : [];
      const tagsLiteral = '{' + tagArr.map(s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
      const result = await sql`
        INSERT INTO xx_resources
          (name, category, sub_type, size, link, tags, pay_type, code_price, lumen_cost, access_level, import_channel, source, status, created_at, updated_at)
        VALUES
          (${name}, ${category}, ${sub_type}, ${size || ''}, ${link}, ${tagsLiteral}::text[], ${pt}, ${price.toFixed(2)}, ${lumen}, ${accessLevel}, 'admin_manual', 'admin', 'active', NOW(), NOW())
        RETURNING id, name, category, sub_type, size, pay_type, code_price, lumen_cost, access_level, status
      ` as any[];
      const created = result[0];
      return NextResponse.json({ success: true, item: created, message: `✅ 已发布资源 #${created.id}` });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // ============ 更新模式 (默认) ============
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 });
  if (pay_type && !['free', 'code', 'lumen'].includes(pay_type)) {
    return NextResponse.json({ error: 'pay_type must be "free", "code" or "lumen"' }, { status: 400 });
  }
  const priceNum = code_price !== undefined ? Number(code_price) : null;
  if (priceNum !== null && (isNaN(priceNum) || priceNum < 0 || priceNum > 9999)) {
    return NextResponse.json({ error: 'code_price must be 0-9999' }, { status: 400 });
  }
  const lumenNum = lumen_cost !== undefined ? Number(lumen_cost) : null;
  if (lumenNum !== null && (!Number.isInteger(lumenNum) || lumenNum < 1 || lumenNum > 999)) {
    return NextResponse.json({ error: 'lumen_cost must be 1-999' }, { status: 400 });
  }

  try {
    // 2026-07-28: 改用 sql 模板串 (Neon v3 不支持 unsafe 链式)
    const setParts: string[] = [];
    const setVals: any[] = [];
    const addSet = (clause: string, ...vals: any[]) => {
      const offset = setVals.length;
      const renum = clause.replace(/\$(\d+)/g, (_, n) => `$${parseInt(n) + offset}`);
      setParts.push(renum);
      setVals.push(...vals);
    };
    if (pay_type) {
      addSet('pay_type = $1', pay_type);
      // 同步 access_level: code → code, lumen/free → basic
      if (pay_type === 'code') addSet('access_level = $1', 'code');
      else if (pay_type === 'lumen' || pay_type === 'free') addSet('access_level = $1', 'basic');
    }
    if (priceNum !== null) addSet('code_price = $1', priceNum.toFixed(2));
    if (lumenNum !== null) addSet('lumen_cost = $1', lumenNum);
    addSet('updated_at = NOW()');

    if (setParts.length === 1) {
      return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
    }
    setVals.push(Number(id));
    const idPh = `$${setVals.length}`;
    const sqlText = `UPDATE xx_resources SET ${setParts.join(', ')} WHERE id = ${idPh} RETURNING id, pay_type, code_price, lumen_cost, access_level`;

    const updated = await sql(sqlText, setVals) as any[];
    return NextResponse.json({ success: true, item: updated[0] });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // 批量：把所有 pay_type='code' 资源改回 'free' + access_level='basic'
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    await sql`UPDATE xx_resources SET pay_type = 'free', code_price = 0.00, access_level = 'basic' WHERE pay_type = 'code'`;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
