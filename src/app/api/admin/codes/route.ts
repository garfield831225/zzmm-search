// 2026-07-20: 改用共享 authAdmin (双轨鉴权 Bearer + cookie), 修激活码卡打不开的 bug
// 2026-07-21: 修 duration NOT NULL 500 错 + 加导出/删除/延期 (跟 invites 同步)
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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

// 生成激活码 (POST)
export async function POST(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  const planKey = String(body.plan || 'vip_30d');
  const count = Math.max(1, Math.min(1000, parseInt(String(body.count || 1), 10)));
  const channel = String(body.channel || 'xy');
  const note = String(body.note || '').slice(0, 200);
  const batchId = body.batch_id ? String(body.batch_id).slice(0, 50) : null;
  const lumenAmount = body.lumen_amount ? parseInt(String(body.lumen_amount), 10) : null;
  const targetResourceId = body.target_resource_id ? parseInt(String(body.target_resource_id), 10) : null;

  // 2026-07-28: 4 种 plan: vip_30d/180d/365d/forever (VIP) + lumen (流明) + unlock (单资源)
  // 不同的 code_type 走不同的 INSERT
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const codes: string[] = [];
    // 流明码默认 1 年有效 (避免后台忘了清, 长期堆积)
    const baseExpiresAt = new Date(Date.now() + 365 * 86400000).toISOString();

    if (planKey === 'lumen') {
      // 流明兑换码: code_type='lumen', user_group=任意(谁都能用)
      if (!lumenAmount || lumenAmount < 1 || lumenAmount > 1000000) {
        return NextResponse.json({ error: '流明数必须 1-1000000' }, { status: 400 });
      }
      for (let i = 0; i < count; i++) codes.push(genCodeFull(channel));
      const BATCH = 50;
      let inserted = 0;
      for (let i = 0; i < codes.length; i += BATCH) {
        const slice = codes.slice(i, i + BATCH);
        await Promise.all(slice.map(code =>
          sql`INSERT INTO xx_activation_codes
              (code, code_type, plan_id, duration, channel, sent_note, batch_id, created_by, expires_at, is_used, user_group, lumen_amount, price_at_issue)
              VALUES (${code}, 'lumen', 'LUMEN-CODE', 0, ${channel}, ${note}, ${batchId}, ${auth.userId}, ${baseExpiresAt}, false, 'user', ${lumenAmount}, 0)`
            .then(() => { inserted++; })
            .catch((e: any) => {
              if (!String(e.message).includes('duplicate key') && !String(e.message).includes('unique')) throw e;
            })
        ));
      }
      return NextResponse.json({
        codes, plan: '流明兑换码', plan_id: 'LUMEN-CODE', count, channel,
        channel_label: channel === 'wd' ? '微店' : '闲鱼',
        batch_id: batchId || '', price_at_issue: 0, lumen_amount: lumenAmount,
        inserted, requested: count
      });
    }

    if (planKey === 'unlock') {
      // 单资源解锁码: code_type='unlock', target_resource_id 必填
      if (!targetResourceId) {
        return NextResponse.json({ error: '请指定 target_resource_id' }, { status: 400 });
      }
      for (let i = 0; i < count; i++) codes.push(genCodeFull(channel));
      const BATCH = 50;
      let inserted = 0;
      for (let i = 0; i < codes.length; i += BATCH) {
        const slice = codes.slice(i, i + BATCH);
        await Promise.all(slice.map(code =>
          sql`INSERT INTO xx_activation_codes
              (code, code_type, plan_id, duration, channel, sent_note, batch_id, created_by, expires_at, is_used, user_group, target_resource_id, price_at_issue)
              VALUES (${code}, 'unlock', 'UNLOCK', 0, ${channel}, ${note}, ${batchId}, ${auth.userId}, ${baseExpiresAt}, false, 'user', ${targetResourceId}, 0)`
            .then(() => { inserted++; })
            .catch((e: any) => {
              if (!String(e.message).includes('duplicate key') && !String(e.message).includes('unique')) throw e;
            })
        ));
      }
      return NextResponse.json({
        codes, plan: '单资源解锁码', plan_id: 'UNLOCK', count, channel,
        channel_label: channel === 'wd' ? '微店' : '闲鱼',
        batch_id: batchId || '', price_at_issue: 0, target_resource_id: targetResourceId,
        inserted, requested: count
      });
    }

    // VIP 套餐 (vip_30d/180d/365d/forever)
    const plan = VIP_PLANS[planKey];
    if (!plan) return NextResponse.json({ error: '未知的 plan: ' + planKey }, { status: 400 });

    const expiresAt = plan.duration > 0
      ? new Date(Date.now() + plan.duration * 86400000).toISOString()
      : null;
    const durationValue = plan.duration > 0 ? plan.duration : 9999;
    for (let i = 0; i < count; i++) codes.push(genCodeFull(channel));
    const BATCH = 50;
    let inserted = 0;
    for (let i = 0; i < codes.length; i += BATCH) {
      const slice = codes.slice(i, i + BATCH);
      await Promise.all(slice.map(code =>
        sql`INSERT INTO xx_activation_codes
            (code, code_type, plan_id, duration, channel, sent_note, batch_id, created_by, expires_at, is_used, user_group, price_at_issue)
            VALUES (${code}, 'vip', ${plan.plan_id}, ${durationValue}, ${channel}, ${note}, ${batchId}, ${auth.userId}, ${expiresAt}, false, 'vip', ${plan.default_price})`
          .then(() => { inserted++; })
          .catch((e: any) => {
            if (!String(e.message).includes('duplicate key') && !String(e.message).includes('unique')) throw e;
          })
      ));
    }
    return NextResponse.json({
      codes, plan: plan.label, plan_id: plan.plan_id, count, channel,
      channel_label: channel === 'wd' ? '微店' : '闲鱼',
      batch_id: batchId || '', price_at_issue: plan.default_price,
      inserted, requested: count
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// GET 列表 + 导出
export async function GET(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const exportFmt = searchParams.get('export'); // 'csv' | 'txt' | null
  const filter = searchParams.get('filter') || 'all'; // all|unused|used|expired
  const idsParam = searchParams.get('ids');
  const planFilter = searchParams.get('plan'); // plan_id 过滤

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    // 导出模式
    if (exportFmt === 'csv' || exportFmt === 'txt') {
      const allRows: any = await sql`
        SELECT id, code, plan_id, duration, channel, sent_note, created_at, expires_at, is_used
        FROM xx_activation_codes ORDER BY id DESC LIMIT 10000
      `;
      const ids = idsParam?.split(',').map(s => parseInt(s, 10)).filter(n => n > 0) || [];
      const filtered = applyFilter(allRows, { filter, ids, plan: planFilter || undefined });

      if (exportFmt === 'csv') {
        const lines = ['code,plan_id,duration,channel,note,created_at,expires_at,is_used'];
        for (const r of filtered) {
          lines.push(`${r.code},${r.plan_id || ''},${r.duration || ''},${r.channel || ''},"${(r.sent_note || '').replace(/"/g, '""')}",${r.created_at || ''},${r.expires_at || ''},${r.is_used}`);
        }
        return new NextResponse(lines.join('\n'), {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="activation_codes_${filter}_${Date.now()}.csv"`,
          },
        });
      } else {
        return new NextResponse(filtered.map(r => r.code).join('\n'), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="activation_codes_${filter}_${Date.now()}.txt"`,
          },
        });
      }
    }

    // 普通列表
    const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') || '100', 10)));
    const rows: any = await sql`
      SELECT id, code, code_type, plan_id, duration, channel, sent_note, created_at, used_at, used_by, expires_at, is_used
      FROM xx_activation_codes ORDER BY id DESC LIMIT ${limit}
    `;
    const total = await sql`SELECT COUNT(*)::int AS c FROM xx_activation_codes`;
    const used = await sql`SELECT COUNT(*)::int AS c FROM xx_activation_codes WHERE is_used = true`;
    const expired = await sql`SELECT COUNT(*)::int AS c FROM xx_activation_codes WHERE is_used = false AND expires_at IS NOT NULL AND expires_at < NOW()`;
    return NextResponse.json({
      items: rows,
      stats: { total: total[0].c, used: used[0].c, unused: total[0].c - used[0].c, expired: expired[0].c },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function applyFilter(rows: any[], opts: { filter?: string; ids?: number[]; plan?: string }) {
  let r = rows;
  if (opts.filter === 'unused') r = r.filter(x => !x.is_used);
  if (opts.filter === 'used') r = r.filter(x => x.is_used);
  if (opts.filter === 'expired') r = r.filter(x => !x.is_used && x.expires_at && new Date(x.expires_at) < new Date());
  if (opts.ids && opts.ids.length) r = r.filter(x => opts.ids!.includes(x.id));
  if (opts.plan) r = r.filter(x => x.plan_id === opts.plan);
  return r;
}

// DELETE 单/批量/清空
export async function DELETE(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const body = await req.json().catch(() => ({}));
    const action = body.action || (body.ids ? 'batch' : (body.id ? 'one' : 'all_unused'));

    if (action === 'all_unused') {
      const r = await sql`DELETE FROM xx_activation_codes WHERE is_used = false`;
      return NextResponse.json({ success: true, deleted: r.length });
    }
    if (action === 'all_expired') {
      const r = await sql`DELETE FROM xx_activation_codes WHERE is_used = false AND expires_at IS NOT NULL AND expires_at < NOW()`;
      return NextResponse.json({ success: true, deleted: r.length });
    }
    if (action === 'all_used') {
      const r = await sql`DELETE FROM xx_activation_codes WHERE is_used = true`;
      return NextResponse.json({ success: true, deleted: r.length });
    }
    if (action === 'batch' && Array.isArray(body.ids) && body.ids.length > 0) {
      const ids = body.ids.map((x: any) => parseInt(String(x), 10)).filter((n: number) => n > 0);
      if (ids.length === 0) return NextResponse.json({ error: 'ids 数组为空' }, { status: 400 });
      // 只删未使用的
      const r = await sql`DELETE FROM xx_activation_codes WHERE id = ANY(${ids}::int[]) AND is_used = false`;
      return NextResponse.json({ success: true, deleted: r.length, requested: ids.length });
    }
    if (action === 'one' && body.id) {
      const id = parseInt(String(body.id), 10);
      const r = await sql`DELETE FROM xx_activation_codes WHERE id = ${id} AND is_used = false`;
      if (r.length === 0) return NextResponse.json({ error: '激活码不存在或已使用' }, { status: 404 });
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: '未知 action 或缺少 id' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// PATCH 改 is_used + 延期
export async function PATCH(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const body = await req.json().catch(() => {}) as any;

    // 延期 (跟 invites 一样, 改 expires_at)
    if (body.extend) {
      const days = parseInt(String(body.days || 30), 10);
      if (!Number.isFinite(days) || days < 1 || days > 3650) {
        return NextResponse.json({ error: 'days 必须在 1-3650 之间' }, { status: 400 });
      }
      const newExpiresAt = new Date(Date.now() + days * 86400000).toISOString();

      if (Array.isArray(body.ids) && body.ids.length > 0) {
        const ids = body.ids.map((x: any) => parseInt(String(x), 10)).filter((n: number) => n > 0);
        if (ids.length === 0) return NextResponse.json({ error: 'ids 数组为空' }, { status: 400 });
        const r = await sql`UPDATE xx_activation_codes SET expires_at = ${newExpiresAt} WHERE id = ANY(${ids}::int[])`;
        return NextResponse.json({ success: true, updated: r.length, expires_at: newExpiresAt });
      }

      const id = parseInt(String(body.id || 0), 10);
      if (!id) return NextResponse.json({ error: '需要 id 或 ids' }, { status: 400 });
      const r = await sql`UPDATE xx_activation_codes SET expires_at = ${newExpiresAt} WHERE id = ${id}`;
      return NextResponse.json({ success: true, updated: r.length || 1, expires_at: newExpiresAt });
    }

    // 标记已用 / 取消已用
    const id = parseInt(String(body.id || 0), 10);
    if (!id) return NextResponse.json({ error: '需要 id' }, { status: 400 });
    const isUsed = body.is_used === true;

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
