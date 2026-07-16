// 2026-07-16: Vercel cron 调用的 TG L3 worker
// 路径: /api/cron/tg-l3-worker
// Vercel cron 每天 03:00 + 15:00 触发
// 不走 Bearer 鉴权, 任何人都不能直接访问 (中间件白名单限制)
// 内部调用 tg-l3-worker 的处理逻辑

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// 简化的 detectSource (不依赖 import-classifier, 避免循环)
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

function extractRealUrlsFromTelegra(html: string): { url: string; password?: string }[] {
  const results: { url: string; password?: string }[] = [];
  if (!html) return results;

  const aRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
  let aMatch: RegExpExecArray | null;
  while ((aMatch = aRegex.exec(html)) !== null) {
    const href = aMatch[1];
    if (href.includes('telegra.ph/') || href.startsWith('#')) continue;
    results.push({ url: href });
  }

  const magnetRegex = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/g;
  let magnetMatch: RegExpExecArray | null;
  while ((magnetMatch = magnetRegex.exec(html)) !== null) {
    if (!results.some(r => r.url === magnetMatch![0])) results.push({ url: magnetMatch[0] });
  }

  const ed2kRegex = /ed2k:\/\/\|file\|[^|]+\|[^|]+\|[a-fA-F0-9]+\|[^|]*\|/g;
  let ed2kMatch: RegExpExecArray | null;
  while ((ed2kMatch = ed2kRegex.exec(html)) !== null) {
    if (!results.some(r => r.url === ed2kMatch![0])) results.push({ url: ed2kMatch[0] });
  }

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

// 抓一批 telegra.ph
async function processBatch(sql: any, batchSize: number) {
  // 原子拿队列
  const pending = await sql`
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

  let succeeded = 0, failed = 0, noLinks = 0;
  const errors: string[] = [];

  for (let i = 0; i < pending.length; i++) {
    const item = pending[i];
    try {
      const resp = await fetch(item.telegra_ph_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; zzmm-l3-worker/1.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const realUrls = extractRealUrlsFromTelegra(html);

      if (realUrls.length === 0) {
        await sql`
          UPDATE xx_telegram_l3_queue
          SET status = 'done', updated_at = NOW(), processed_at = NOW(),
              fetched_html = ${html.slice(0, 5000)}, last_error = 'no_real_urls_found'
          WHERE id = ${item.id}
        `;
        noLinks++;
      } else {
        const parent = item.parent_resource_id
          ? (await sql`SELECT name, category, access_level, pay_type, import_channel, tags FROM xx_resources WHERE id = ${item.parent_resource_id} LIMIT 1` as any[])[0]
          : null;
        const baseName = parent?.name || 'TG资源';
        const category = parent?.category || '其他';
        const accessLevel = parent?.access_level || 'vip';
        const payType = parent?.pay_type || 'vip';
        const importChannel = parent?.import_channel || 'tg_baidu';
        const tags = parent?.tags || '';

        for (const u of realUrls) {
          try {
            const source = detectSource(u.url);
            const det = u.url.match(/[?&](?:pwd|code)=([a-zA-Z0-9_-]+)/);
            const password = u.password || det?.[1] || '';
            await sql`
              INSERT INTO xx_resources (name, link, link_code, source, category, tags, access_level, pay_type, import_channel, l3_from, status, created_at, updated_at)
              VALUES (${baseName}, ${u.url}, ${password}, ${source}, ${category}, ${tags}, ${accessLevel}, ${payType}, ${importChannel}, ${item.parent_resource_id || null}, 'active', NOW(), NOW())
              ON CONFLICT (link, name) DO NOTHING
            `;
          } catch { /* 单条失败不影响 */ }
        }
        await sql`
          UPDATE xx_telegram_l3_queue
          SET status = 'done', updated_at = NOW(), processed_at = NOW(),
              fetched_html = ${html.slice(0, 5000)}, real_url = ${realUrls[0]?.url || null}
          WHERE id = ${item.id}
        `;
        succeeded++;
      }
    } catch (e: any) {
      const isLastAttempt = (item.attempts || 0) >= 3;
      const newStatus = isLastAttempt ? 'failed' : 'pending';
      await sql`
        UPDATE xx_telegram_l3_queue
        SET status = ${newStatus}, updated_at = NOW(), last_error = ${e.message?.slice(0, 500) || 'unknown'}
        WHERE id = ${item.id}
      `;
      failed++;
      if (errors.length < 5) errors.push(`[id=${item.id}] ${e.message?.slice(0, 100)}`);
    }
    // sleep 1s 防限流
    if (i < pending.length - 1) await new Promise(r => setTimeout(r, 1000));
  }

  return { processed: pending.length, succeeded, failed, noLinks, errors };
}

// GET: 健康检查 + 当前队列状态
export async function GET(req: NextRequest) {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const stats = await sql`SELECT status, COUNT(*)::int as cnt FROM xx_telegram_l3_queue GROUP BY status` as any[];
    return NextResponse.json({
      ok: true,
      trigger: 'GET (health check)',
      by_status: Object.fromEntries(stats.map(s => [s.status, s.cnt])),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message?.slice(0, 200) }, { status: 500 });
  }
}

// POST: Vercel cron 触发
export async function POST(req: NextRequest) {
  const start = Date.now();
  const sql = neon(process.env.DATABASE_URL || '');

  // 一次跑 50 条 (1s/条 + 抓取 1-2s/条 = 50 * 2.5s = 125s, 但 Vercel Hobby 60s 限制)
  // 改 30 条: 30 * 2s = 60s, 刚好
  const batchSize = 30;

  try {
    const result = await processBatch(sql, batchSize);
    return NextResponse.json({
      ok: true,
      trigger: 'vercel-cron',
      batchSize,
      ...result,
      duration_ms: Date.now() - start,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message?.slice(0, 200), duration_ms: Date.now() - start }, { status: 500 });
  }
}
