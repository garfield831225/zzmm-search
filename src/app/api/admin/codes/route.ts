// 2026-07-20: 改用共享 authAdmin (双轨鉴权 Bearer + cookie), 修激活码卡打不开的 bug
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

// 生成激活码
export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const planKey = String(body.plan || 'vip_30d');
  const count = Math.max(1, Math.min(500, parseInt(String(body.count || 1), 10)));
  const channel = String(body.channel || 'xy');
  const note = String(body.note || '').slice(0, 200);

  const plan = VIP_PLANS[planKey];
  if (!plan) return NextResponse.json({ error: '未知的 plan: ' + planKey }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const codes: string[] = [];
    // 2026-07-20: JS 算 expires_at (Neon v3 无 .unsafe(), 避开动态 SQL 注入)
    const expiresAt = plan.duration > 0
      ? new Date(Date.now() + plan.duration * 86400000).toISOString()
      : null;
    for (let i = 0; i < count; i++) codes.push(genCodeFull(channel));
    for (const code of codes) {
      // 2026-07-20: 真表名 xx_activation_codes, 真列名 sent_note (不是 note)
      await sql`INSERT INTO xx_activation_codes (code, code_type, plan_id, channel, sent_note, created_by, expires_at, is_used, user_group)
                VALUES (${code}, 'vip', ${plan.plan_id}, ${channel}, ${note}, ${auth.userId}, ${expiresAt}, false, 'vip')`;
    }
    return NextResponse.json({ codes, plan: plan.label, count, channel });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// 列表
export async function GET(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`SELECT id, code, code_type, plan_id, duration, channel, sent_note, created_at, used_at, used_by, expires_at, is_used
      FROM xx_activation_codes ORDER BY id DESC LIMIT ${limit}`;
    return NextResponse.json({ items: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// 标记已用 / 取消已用
export async function PATCH(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const id = parseInt(String(body.id || 0), 10);
  const isUsed = body.is_used === true;
  if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    if (isUsed) {
      await sql`UPDATE xx_activation_codes SET is_used = true, used_at = NOW() WHERE id = ${id}`;
    } else {
      await sql`UPDATE xx_activation_codes SET is_used = false, used_at = NULL, used_by = NULL WHERE id = ${id}`;
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
