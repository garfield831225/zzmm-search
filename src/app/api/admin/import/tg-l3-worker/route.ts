// 2026-07-16: TG L3 (telegra.ph) 抓取 worker
// GET: 查队列状态 (pending/processing/done/failed 数量, 最近 10 条)
// POST: 触发处理 - 一次最多 50 条, 每条 sleep 1 秒防限流
//   - Vercel cron 调用: 每天 03:00 + 15:00
//   - UI 手动触发: admin 点 "开始抓 L3" 按钮

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const maxDuration = 60;  // Vercel hobby 上限, 1 次最多跑 50 条 telegra.ph 抓取 (1s/条 + overhead)

// 鉴权: VIP + admin 才能手动触发
// GET (status): admin only (后台数据)
// POST (process): VIP + admin
function getAuth(req: NextRequest, allowVip = false) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    // Vercel cron 调用可以用 CRON_SECRET 鉴权
    const cronKey = req.nextUrl.searchParams.get('cronKey');
    if (cronKey && cronKey === (process.env.CRON_SECRET || 'zzmm-cron-secret-2025')) {
      return { userId: 'cron', username: 'vercel-cron', group: 'admin' };
    }
    return { error: '未登录', status: 401 };
  }
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    const group = String(payload.user_group || payload.group || 'user').toLowerCase();
    if (allowVip) {
      if (group !== 'vip' && group !== 'admin') {
        return { error: '此功能仅 VIP/admin 可用', status: 403 };
      }
    } else {
      if (group !== 'admin') {
        return { error: '此功能仅 admin 可用', status: 403 };
      }
    }
    return { userId: String(payload.id), username: payload.username, group };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

// 解析 telegra.ph HTML 拿真链 (magnet / ed2k / 网盘)
function extractRealUrlsFromTelegra(html: string): { url: string; password?: string }[] {
  const results: { url: string; password?: string }[] = [];
  if (!html) return results;

  // 1. 找 <a href="..."> 链接
  const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = aRegex.exec(html)) !== null) {
    const href = aMatch[1];
    // 跳过 telegra.ph 自身
    if (href.includes('telegra.ph/') || href.startsWith('#')) continue;
    results.push({ url: href });
  }

  // 2. 抓 magnet 纯文本 (telegra.ph 经常不包 <a>)
  const magnetRegex = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/g;
  let magnetMatch: RegExpExecArray | null;
  while ((magnetMatch = magnetRegex.exec(html)) !== null) {
    if (!results.some(r => r.url === magnetMatch![0])) {
      results.push({ url: magnetMatch[0] });
    }
  }

  // 3. 抓 ed2k 纯文本
  const ed2kRegex = /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[a-fA-F0-9]+\|[^|]*\|/g;
  let ed2kMatch: RegExpExecArray | null;
  while ((ed2kMatch = ed2kRegex.exec(html)) !== null) {
    if (!results.some(r => r.url === ed2kMatch![0])) {
      results.push({ url: ed2kMatch[0] });
    }
  }

  // 4. 抓网盘链接 (兜底正则)
  const netdiskRegex = /https?:\/\/(?:pan\.baidu\.com|115\.com|115cdn\.com|pan\.quark\.cn|www\.aliyundrive\.com|www\.alipan\.com)[^\s<>"']+/g;
  let netMatch: RegExpExecArray | null;
  while ((netMatch = netdiskRegex.exec(html)) !== null) {
    if (!results.some(r => r.url === netMatch![0])) {
      const pwdMatch = netMatch[0].match(/[?&](?:pwd|code)=([a-zA-Z0-9_-]+)/);
      results.push({ url: netMatch[0], password: pwdMatch?.[1] });
    }
  }

  return results;
}

// 从 HTML 提取标题 (telegra.ph 文章 <h1> 或 <title>)
function extractTitleFromTelegraHtml(html: string): string {
  let m = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (m) {
    return m[1].replace(/<[^>]+>/g, '').trim().slice(0, 200);
  }
  m = html.match(/<title>(.*?)<\/title>/i);
  if (m) {
    return m[1].trim().slice(0, 200);
  }
  return '';
}

// GET: 查状态
export async function GET(req: NextRequest) {
  const auth = getAuth(req, false);  // admin only
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '10', 10);

  try {
    const stats = await sql`
      SELECT
        status,
        COUNT(*)::int as cnt
      FROM xx_telegram_l3_queue
      GROUP BY status
    ` as any[];

    const total = await sql`SELECT COUNT(*)::int as cnt FROM xx_telegram_l3_queue` as any[];

    const recent = await sql`
      SELECT id, telegra_ph_url, status, attempts, last_error, created_at, processed_at, result_resource_id
      FROM xx_telegram_l3_queue
      ORDER BY created_at DESC
      LIMIT ${limit}
    ` as any[];

    return NextResponse.json({
      total: total[0]?.cnt ?? 0,
      by_status: Object.fromEntries(stats.map((s: any) => [s.status, s.cnt])),
      recent,
      user: auth.username,
    });
  } catch (e: any) {
    return NextResponse.json({ error: '查询失败: ' + e.message?.slice(0, 200) }, { status: 500 });
  }
}

// POST: 触发处理
// body: { batchSize?: number, dryRun?: boolean }
export async function POST(req: NextRequest) {
  const auth = getAuth(req, true);  // VIP + admin
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(body.batchSize || 50, 100);
  const dryRun = body.dryRun === true;

  try {
    // 1. 原子拿一批 pending 队列 (UPDATE ... RETURNING 替代 SELECT FOR UPDATE, Neon HTTP 不支持)
    let pending: any[] = [];
    try {
      const r = await sql`
        UPDATE xx_telegram_l3_queue
        SET status = 'processing', updated_at = NOW(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM xx_telegram_l3_queue
          WHERE status = 'pending' AND attempts < 3
          ORDER BY created_at ASC
          LIMIT ${batchSize}
        )
        RETURNING id, telegra_ph_url, parent_resource_id, source_message_id, attempts
      ` as any[];
      pending = r || [];
    } catch (e: any) {
      return NextResponse.json({ error: '原子拿队列失败: ' + e.message?.slice(0, 200) }, { status: 500 });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        would_process: pending.length,
        user: auth.username,
      });
    }

    let succeeded = 0;
    let failed = 0;
    let noLinks = 0;
    const errors: string[] = [];

    // 2. 逐条抓 telegra.ph
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      try {
        const resp = await fetch(item.telegra_ph_url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; zzmm-l3-worker/1.0)' },
          signal: AbortSignal.timeout(15000),  // 15s 超时
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }

        const html = await resp.text();
        const realUrls = extractRealUrlsFromTelegra(html);

        if (realUrls.length === 0) {
          // 抓到但没真链, 标 done (不重试)
          await sql`
            UPDATE xx_telegram_l3_queue
            SET status = 'done', updated_at = NOW(), processed_at = NOW(),
                fetched_html = ${html.slice(0, 5000)}, last_error = 'no_real_urls_found'
            WHERE id = ${item.id}
          `;
          noLinks++;
        } else {
          // 插入新资源 (L3 真链)
          const parentResource = item.parent_resource_id
            ? (await sql`SELECT name, category, access_level, pay_type, import_channel, tags FROM xx_resources WHERE id = ${item.parent_resource_id} LIMIT 1` as any[])[0]
            : null;

          const baseName = parentResource?.name || 'TG资源';
          const category = parentResource?.category || '其他';
          const accessLevel = parentResource?.access_level || 'vip';
          const payType = parentResource?.pay_type || 'vip';
          const importChannel = parentResource?.import_channel || 'tg_baidu';
          const tags = parentResource?.tags || '';

          let insertedCount = 0;
          for (const u of realUrls) {
            try {
              const source = detectSource(u.url);
              const det = u.url.match(/[?&](?:pwd|code)=([a-zA-Z0-9_-]+)/);
              const password = u.password || det?.[1] || '';

              const r = await sql`
                INSERT INTO xx_resources (name, link, link_code, source, category, tags, access_level, pay_type, import_channel, l3_from, status, created_at, updated_at)
                VALUES (${baseName}, ${u.url}, ${password}, ${source}, ${category}, ${tags}, ${accessLevel}, ${payType}, ${importChannel}, ${item.parent_resource_id || null}, 'active', NOW(), NOW())
                ON CONFLICT (link, name) DO NOTHING
                RETURNING id
              ` as any[];
              if (r?.[0]?.id) insertedCount++;
            } catch {
              // 单条失败不影响
            }
          }

          // 标记 queue done
          await sql`
            UPDATE xx_telegram_l3_queue
            SET status = 'done', updated_at = NOW(), processed_at = NOW(),
                fetched_html = ${html.slice(0, 5000)}, real_url = ${realUrls[0]?.url || null},
                real_url_password = ${realUrls[0]?.password || null},
                result_resource_id = ${null}
            WHERE id = ${item.id}
          `;
          succeeded++;
        }
      } catch (e: any) {
        // 失败: 标 failed (如果 attempts >= 3) 或 回到 pending
        const isLastAttempt = (item.attempts || 0) >= 3;
        const newStatus = isLastAttempt ? 'failed' : 'pending';
        await sql`
          UPDATE xx_telegram_l3_queue
          SET status = ${newStatus}, updated_at = NOW(),
              last_error = ${e.message?.slice(0, 500) || 'unknown'}
          WHERE id = ${item.id}
        `;
        failed++;
        if (errors.length < 5) errors.push(`[id=${item.id}] ${e.message?.slice(0, 100)}`);
      }

      // sleep 1s 防限流 (Vercel timeout 60s, 50 条刚好 50s)
      if (i < pending.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return NextResponse.json({
      success: true,
      processed: pending.length,
      succeeded,
      failed,
      no_links: noLinks,
      errors: errors.length > 0 ? errors : undefined,
      user: auth.username,
    });
  } catch (e: any) {
    return NextResponse.json({ error: '处理失败: ' + e.message?.slice(0, 200) }, { status: 500 });
  }
}

// 简化版 detectSource (避免循环依赖)
function detectSource(link: string): string {
  if (!link) return 'other';
  const l = link.toLowerCase();
  if (l.startsWith('magnet:') || l.includes('magnet')) return 'magnet';
  if (l.startsWith('ed2k://') || l.includes('ed2k')) return 'ed2k';
  if (l.includes('115.com') || l.includes('115cdn.com')) return '115';
  if (l.includes('quark.cn')) return 'quark';
  if (l.includes('baidu.com')) return 'baidu';
  if (l.includes('aliyun.com') || l.includes('alipan')) return 'aliyun';
  return 'other';
}
