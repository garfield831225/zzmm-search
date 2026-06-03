import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 8 位大小写字母数字（避开易混字符 0/O/1/l/I）
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function genCode8(): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (!['admin'].includes(payload.group)) {
      return { error: '权限不足', status: 403 };
    }
    return { payload };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

// 生成激活码（单资源一次性）
export async function POST(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { count = 1, target_resource_id, price_at_issue = 0, batch = '默认批次' } = body;
  const n = Math.min(100, Math.max(1, parseInt(count)));
  const targetId = target_resource_id ? parseInt(target_resource_id) : null;
  const price = Math.max(0, Math.min(9999, parseFloat(price_at_issue)));

  if (!targetId) {
    return NextResponse.json({ error: '必须指定 target_resource_id (单资源模式)' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // 验证 target_resource_id 真实存在
  const exists = await sql`SELECT id, name, pay_type, code_price FROM xx_resources WHERE id = ${targetId} AND status = 'active'`;
  if (!exists[0]) {
    return NextResponse.json({ error: `资源 ${targetId} 不存在或已下架` }, { status: 400 });
  }
  if (exists[0].pay_type !== 'code') {
    return NextResponse.json({ error: `资源 ${targetId} 未配置付费 (pay_type=${exists[0].pay_type})，请先在 pay-config 配置` }, { status: 400 });
  }

  // 如果 price=0 默认用资源起步价
  const finalPrice = price > 0 ? price : Number(exists[0].code_price) || 0;

  const codes: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < n; i++) {
    let code = '';
    let inserted = false;
    // 重试 5 次防重码
    for (let attempt = 0; attempt < 5 && !inserted; attempt++) {
      code = genCode8();
      try {
        await sql`
          INSERT INTO xx_activation_codes (
            code, plan_id, user_group, duration, is_used, created_by,
            code_type, target_resource_id, price_at_issue, created_at
          )
          VALUES (
            ${code}, 'unlock', 'free', 0, false, ${String(auth.payload.id)},
            'unlock', ${targetId}, ${finalPrice}, NOW()
          )
        `;
        inserted = true;
        codes.push(code);
      } catch (e: any) {
        if (attempt === 4) errors.push(`${code}: ${e.message?.slice(0, 80)}`);
      }
    }
  }

  return NextResponse.json({
    generated: codes.length,
    codes,
    target_resource_id: targetId,
    target_resource_name: (exists[0] as any).name,
    price_at_issue: finalPrice,
    batch,
    errors: errors.length ? errors : undefined,
  });
}

// 列表
export async function GET(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '50'));
  const codeType = searchParams.get('code_type') || '';
  const targetId = searchParams.get('target_resource_id') || '';
  const offset = (page - 1) * pageSize;

  const sql = neon(process.env.DATABASE_URL || '');

  const codeTypeFilter = codeType ? `AND code_type = '${codeType.replace(/'/g, "''")}'` : '1=1';
  const targetFilter = targetId ? `AND target_resource_id = ${parseInt(targetId)}` : '1=1';

  const rows = await sql`
    SELECT ac.id, ac.code, ac.code_type, ac.target_resource_id, ac.price_at_issue,
           ac.is_used, ac.used_by, ac.used_at, ac.created_at,
           r.name as target_resource_name, r.category as target_resource_category
    FROM xx_activation_codes ac
    LEFT JOIN xx_resources r ON ac.target_resource_id = r.id
    WHERE 1=1
      ${codeType ? sql`AND ac.code_type = ${codeType}` : sql``}
      ${targetId ? sql`AND ac.target_resource_id = ${parseInt(targetId)}` : sql``}
    ORDER BY ac.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;

  const cnt = await sql`
    SELECT COUNT(*)::int as cnt FROM xx_activation_codes ac
    WHERE 1=1 ${codeType ? sql`AND ac.code_type = ${codeType}` : sql``} ${targetId ? sql`AND ac.target_resource_id = ${parseInt(targetId)}` : sql``}
  `;

  return NextResponse.json({
    items: rows,
    total: cnt[0]?.cnt,
    page,
    pageSize,
  });
}
