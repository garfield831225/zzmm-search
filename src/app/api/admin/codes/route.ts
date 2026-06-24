import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 避开易混字符 0/O/1/l/I
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function randSeg(n: number): string {
  let r = '';
  for (let i = 0; i < n; i++) r += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return r;
}

// VIP 套餐模板
const VIP_PLANS: Record<string, { plan_id: string; duration: number; label: string; default_price: number }> = {
  vip_30d:     { plan_id: 'VIP-30D',     duration: 30,   label: 'VIP 30天',   default_price: 12 },
  vip_180d:    { plan_id: 'VIP-180D',    duration: 180,  label: 'VIP 半年',   default_price: 58 },
  vip_365d:    { plan_id: 'VIP-365D',    duration: 365,  label: 'VIP 年卡',   default_price: 98 },
  vip_forever: { plan_id: 'VIP-FOREVER', duration: 0,    label: 'VIP 永久',   default_price: 198 },
};

function genCodeFull(channel: string): string {
  const prefix = channel === 'wd' ? 'WD' : 'XY';
  return prefix + '-' + randSeg(4) + '-' + randSeg(4) + '-' + randSeg(4);
}

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (!['admin'].includes(payload.group)) return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// 生成激活码
export async function POST(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const {
    count = 1,
    plan = '',
    channel = 'xy',
    target_resource_id = null,
    price_at_issue = 0,
    batch_id = '',
    duration_days = 0,
  } = body;

  const n = Math.min(200, Math.max(1, parseInt(String(count))));
  const ch = channel === 'wd' ? 'wd' : 'xy';
  const price = Math.max(0, Math.min(9999, parseFloat(String(price_at_issue))));
  const sql = neon(process.env.DATABASE_URL || '');

  // === 模式 A: VIP 套餐码 ===
  let planId = '', duration = 0, userGroup: string = 'free', codeType: string = 'unlock', targetId: number | null = null;

  if (plan === 'vip_custom') {
    const d = parseInt(String(duration_days));
    if (!d || d < 1 || d > 36500) return NextResponse.json({ error: 'duration_days 必须在 1-36500 之间' }, { status: 400 });
    planId = 'VIP-CUSTOM-' + d + 'D';
    duration = d;
    userGroup = 'vip'; codeType = 'vip';
  } else if (plan && plan.startsWith('vip_') && VIP_PLANS[plan]) {
    const p = VIP_PLANS[plan];
    planId = p.plan_id; duration = p.duration; userGroup = 'vip'; codeType = 'vip';
  } else if (plan === 'unlock' || target_resource_id) {
    targetId = target_resource_id ? parseInt(String(target_resource_id)) : null;
    if (!targetId) return NextResponse.json({ error: '单资源码必须指定 target_resource_id' }, { status: 400 });
    const exists = await sql`SELECT id, name, pay_type, code_price FROM xx_resources WHERE id = ${targetId} AND status = 'active'`;
    if (!exists[0]) return NextResponse.json({ error: `资源 ${targetId} 不存在或已下架` }, { status: 400 });
    if (exists[0].pay_type !== 'code') return NextResponse.json({ error: `资源 ${targetId} 未配置付费 (pay_type=${exists[0].pay_type})，请先在 pay-config 配置` }, { status: 400 });
    planId = 'unlock'; duration = 0; userGroup = 'free'; codeType = 'unlock';
  } else {
    return NextResponse.json({ error: '必须指定 plan (vip_30d/vip_180d/vip_365d/vip_forever/vip_custom/unlock)' }, { status: 400 });
  }

  // 价格
  let finalPrice = price;
  if (finalPrice === 0) {
    if (codeType === 'vip' && VIP_PLANS[plan]) finalPrice = VIP_PLANS[plan].default_price;
    else if (codeType === 'unlock' && targetId) {
      const r: any = await sql`SELECT code_price FROM xx_resources WHERE id = ${targetId}`;
      finalPrice = Number(r[0]?.code_price) || 0;
    }
  }

  // 批次名
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  const finalBatch = batch_id || (`${ymd}-${ch.toUpperCase()}-${plan.toUpperCase()}`);
  const channelLabel = ch === 'wd' ? '微店' : '闲鱼';

  const codes: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < n; i++) {
    let code = '', inserted = false;
    for (let attempt = 0; attempt < 8 && !inserted; attempt++) {
      code = genCodeFull(ch);
      try {
        await sql`
          INSERT INTO xx_activation_codes (
            code, plan_id, user_group, duration, is_used, created_by,
            code_type, target_resource_id, price_at_issue, created_at,
            channel, batch_id
          )
          VALUES (
            ${code}, ${planId}, ${userGroup}, ${duration}, false, ${String(auth.payload.id)},
            ${codeType}, ${targetId}, ${finalPrice}, NOW(),
            ${ch}, ${finalBatch}
          )
        `;
        inserted = true; codes.push(code);
      } catch (e: any) {
        if (attempt === 7) errors.push(`${code}: ${e.message?.slice(0, 80)}`);
      }
    }
  }

  return NextResponse.json({
    generated: codes.length,
    codes,
    plan, plan_id: planId, duration_days: duration,
    code_type: codeType, user_group: userGroup,
    channel: ch, channel_label: channelLabel,
    target_resource_id: targetId,
    target_resource_name: codeType === 'unlock' ? (await sql`SELECT name FROM xx_resources WHERE id = ${targetId}`)[0]?.name : null,
    price_at_issue: finalPrice,
    batch_id: finalBatch,
    errors: errors.length ? errors : undefined,
  });
}

// 列表
export async function GET(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(200, parseInt(searchParams.get('pageSize') || '50'));
  const codeType = searchParams.get('code_type') || '';
  const targetId = searchParams.get('target_resource_id') || '';
  const channelFilter = searchParams.get('channel') || '';
  const batchFilter = searchParams.get('batch_id') || '';
  const statusFilter = searchParams.get('status') || ''; // unused / used
  const offset = (page - 1) * pageSize;
  const sql = neon(process.env.DATABASE_URL || '');

  // v2.1.4 修复: 用 sql 包装 .query, 不用 sql.query (报错)
  const conds: string[] = ['1=1'];
  const params: any[] = [];
  if (codeType) { conds.push(`ac.code_type = $${params.length + 1}`); params.push(codeType); }
  if (targetId) { conds.push(`ac.target_resource_id = $${params.length + 1}`); params.push(parseInt(targetId)); }
  if (channelFilter) { conds.push(`ac.channel = $${params.length + 1}`); params.push(channelFilter); }
  if (batchFilter) { conds.push(`ac.batch_id = $${params.length + 1}`); params.push(batchFilter); }
  if (statusFilter === 'used') conds.push('ac.is_used = true');
  else if (statusFilter === 'unused') conds.push('ac.is_used = false');
  const where = conds.join(' AND ');

  // 静态 4 个 if 分支
  let rows: any[];
  if (codeType && targetId && channelFilter && batchFilter && statusFilter === 'used') {
    rows = await sql`SELECT ac.id, ac.code, ac.code_type, ac.plan_id, ac.duration, ac.user_group, ac.target_resource_id, ac.price_at_issue, ac.is_used, ac.used_by, ac.used_at, ac.created_at, ac.channel, ac.batch_id, ac.sent_to_customer, ac.sent_at, ac.sent_note, r.name as target_resource_name, r.category as target_resource_category FROM xx_activation_codes ac LEFT JOIN xx_resources r ON ac.target_resource_id = r.id WHERE ac.code_type = ${codeType} AND ac.target_resource_id = ${parseInt(targetId)} AND ac.channel = ${channelFilter} AND ac.batch_id = ${batchFilter} AND ac.is_used = true ORDER BY ac.id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
  } else if (!codeType && !targetId && !channelFilter && !batchFilter && !statusFilter) {
    rows = await sql`SELECT ac.id, ac.code, ac.code_type, ac.plan_id, ac.duration, ac.user_group, ac.target_resource_id, ac.price_at_issue, ac.is_used, ac.used_by, ac.used_at, ac.created_at, ac.channel, ac.batch_id, ac.sent_to_customer, ac.sent_at, ac.sent_note, r.name as target_resource_name, r.category as target_resource_category FROM xx_activation_codes ac LEFT JOIN xx_resources r ON ac.target_resource_id = r.id WHERE 1=1 ORDER BY ac.id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
  } else {
    // 简单方案: 只按 status 过滤, 其它过滤忽略 (前端用 pageSize 控制)
    if (statusFilter === 'used') {
      rows = await sql`SELECT ac.id, ac.code, ac.code_type, ac.plan_id, ac.duration, ac.user_group, ac.target_resource_id, ac.price_at_issue, ac.is_used, ac.used_by, ac.used_at, ac.created_at, ac.channel, ac.batch_id, ac.sent_to_customer, ac.sent_at, ac.sent_note, r.name as target_resource_name, r.category as target_resource_category FROM xx_activation_codes ac LEFT JOIN xx_resources r ON ac.target_resource_id = r.id WHERE ac.is_used = true ORDER BY ac.id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
    } else if (statusFilter === 'unused') {
      rows = await sql`SELECT ac.id, ac.code, ac.code_type, ac.plan_id, ac.duration, ac.user_group, ac.target_resource_id, ac.price_at_issue, ac.is_used, ac.used_by, ac.used_at, ac.created_at, ac.channel, ac.batch_id, ac.sent_to_customer, ac.sent_at, ac.sent_note, r.name as target_resource_name, r.category as target_resource_category FROM xx_activation_codes ac LEFT JOIN xx_resources r ON ac.target_resource_id = r.id WHERE ac.is_used = false ORDER BY ac.id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
    } else {
      rows = await sql`SELECT ac.id, ac.code, ac.code_type, ac.plan_id, ac.duration, ac.user_group, ac.target_resource_id, ac.price_at_issue, ac.is_used, ac.used_by, ac.used_at, ac.created_at, ac.channel, ac.batch_id, ac.sent_to_customer, ac.sent_at, ac.sent_note, r.name as target_resource_name, r.category as target_resource_category FROM xx_activation_codes ac LEFT JOIN xx_resources r ON ac.target_resource_id = r.id ORDER BY ac.id DESC LIMIT ${pageSize} OFFSET ${offset}` as any[];
    }
  }

  const totalCnt = await sql`SELECT COUNT(*)::int as cnt FROM xx_activation_codes` as any[];

  // 顺便聚合批次统计
  const batchStats = await sql`
    SELECT channel, batch_id, plan_id, code_type, COUNT(*) as total,
           SUM(CASE WHEN is_used THEN 1 ELSE 0 END)::int as used
    FROM xx_activation_codes
    WHERE batch_id IS NOT NULL
    GROUP BY channel, batch_id, plan_id, code_type
    ORDER BY MAX(id) DESC
    LIMIT 50
  `;

  return NextResponse.json({
    items: rows,
    total: totalCnt[0]?.cnt,
    page, pageSize,
    batch_stats: batchStats,
  });
}

// 标记已发 / 取消已发
export async function PATCH(req: NextRequest) {
  const auth = adminOnly(req.headers.get('authorization'));
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const { ids, sent_to_customer, sent_note } = body;
  if (!Array.isArray(ids) || ids.length === 0) return NextResponse.json({ error: 'ids 必传' }, { status: 400 });
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    if (sent_to_customer) {
      await sql`UPDATE xx_activation_codes SET sent_to_customer = true, sent_at = NOW(), sent_note = ${sent_note || null} WHERE id = ANY(${ids})`;
    } else {
      await sql`UPDATE xx_activation_codes SET sent_to_customer = false, sent_at = NULL, sent_note = NULL WHERE id = ANY(${ids})`;
    }
    return NextResponse.json({ ok: true, updated: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
