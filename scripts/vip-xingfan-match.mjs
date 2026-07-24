#!/usr/bin/env node
// 2026-07-24 zzmm-vip - xingfan.cc 匹配脚本
// 流程: 取 xx_vip_resources 没链接的 → 用标题去 xingfan.cc 搜 → 找详情页 → 抓所有 play_url → 入库
// 跑法: node scripts/vip-xingfan-match.mjs --limit 200 --concurrency 5
//
// 跑前: 必须 vip-tmdb-sync 先跑一遍, 让 DB 有数据
// 部署: NAS, 走 Windows Clash 代理

import { neon } from '@neondatabase/serverless';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import * as cheerio from 'cheerio';

const HTTP_PROXY = process.env.HTTP_PROXY || 'http://192.168.3.3:7897';
const DB_URL = process.env.DATABASE_URL;
const XINGFAN_BASE = 'https://www.xingfan.cc';

if (!DB_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

const dispatcher = new ProxyAgent(HTTP_PROXY);
setGlobalDispatcher(dispatcher);

const sql = neon(DB_URL);

// ---- 限流: 1 req/sec 避免被风控 (xingfan 抓得多) ----
let lastReqAt = 0;
const MIN_INTERVAL_MS = 1000;

async function xfFetch(path) {
  const url = path.startsWith('http') ? path : `${XINGFAN_BASE}${path}`;
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastReqAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReqAt = Date.now();

  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`xingfan ${resp.status} ${url}`);
  }
  return resp.text();
}

// ---- slug 化: 中文/英数字 → URL 路径 (xingfan 详情页形如 /oumeiju/aerfanandiyiji/) ----
// xingfan 的 slug 是拼音首字母 + 简写, 不是简单转拼音
// 简单方案: 直接用搜索 API 拿 URL, 不自己拼

// ---- 在 xingfan.cc 搜标题 ----
async function searchXingfan(title) {
  // xingfan search URL 实测: /index.php?s=home-search.html&wd={title}
  const searchUrl = `/index.php?s=home-search.html&wd=${encodeURIComponent(title)}`;
  const html = await xfFetch(searchUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const results = [];
  // 搜结果页: 找带 /[category]/ 路径的链接 (详情页)
  $('a[href*="/"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    // 详情页形如: /oumeiju/aerfanandiyiji/  或  /dianying/somename/
    if (href.match(/^\/[a-z]+\/[a-z0-9-]+\/?$/i)) {
      const titleText = $(el).text().trim();
      if (titleText && titleText.length > 0 && titleText.length < 100) {
        results.push({ url: href, title: titleText });
      }
    }
  });

  // 去重
  const seen = new Set();
  return results.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });
}

// ---- 标题相似度 (Jaccard 字符集合) ----
function similarity(a, b) {
  if (!a || !b) return 0;
  const sa = new Set(a.toLowerCase().replace(/\s+/g, '').split(''));
  const sb = new Set(b.toLowerCase().replace(/\s+/g, '').split(''));
  const inter = new Set([...sa].filter((x) => sb.has(x)));
  const union = new Set([...sa, ...sb]);
  return inter.size / union.size;
}

// ---- 从详情页抓所有 play_url ----
async function extractPlayUrls(detailUrl) {
  const html = await xfFetch(detailUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const eps = [];

  // 抓所有 episode-link, 形如 <a href=".../1-1.html" class="episode-link">
  $('.episode-link').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/(\d+)-(\d+)\.html$/);
    if (m) {
      eps.push({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        playUrl: href.startsWith('http') ? href : `${XINGFAN_BASE}${href}`,
      });
    }
  });

  // 也可能详情页本身就是播放页 (有 cms_play)
  // 电影通常直接是 /1-1.html 单集
  if (eps.length === 0) {
    const m = detailUrl.match(/(\d+)-(\d+)\.html$/);
    if (m) {
      eps.push({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        playUrl: detailUrl,
      });
    }
  }

  return eps;
}

// ---- 简单并发控制 ----
async function pMap(items, mapper, concurrency) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await mapper(items[i], i);
    }
  }
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

// ---- 入库 links ----
async function insertLinks(resourceId, source, sourceUrl, eps) {
  let inserted = 0;
  for (const ep of eps) {
    try {
      await sql`
        INSERT INTO xx_vip_links (
          resource_id, source, source_url, play_url, season, episode,
          status, match_confidence, last_check_at, last_ok_at, matched_via
        ) VALUES (
          ${resourceId}, ${source}, ${sourceUrl}, ${ep.playUrl}, ${ep.season}, ${ep.episode},
          'ok', ${ep.confidence || 0.5}, NOW(), NOW(), 'title_search'
        )
        ON CONFLICT (resource_id, source, season, episode) DO UPDATE SET
          play_url = EXCLUDED.play_url,
          source_url = EXCLUDED.source_url,
          status = 'ok',
          match_confidence = EXCLUDED.match_confidence,
          last_check_at = NOW(),
          last_ok_at = NOW(),
          fail_count = 0,
          updated_at = NOW()
      `;
      inserted++;
    } catch (e) {
      // UNIQUE 冲突: 跳过
    }
  }
  return inserted;
}

// ---- 取一条没链接的资源 ----
async function fetchPending(limit) {
  return await sql`
    SELECT id, tmdb_id, media_type, title, original_title
    FROM xx_vip_resources r
    WHERE NOT EXISTS (
      SELECT 1 FROM xx_vip_links l
      WHERE l.resource_id = r.id AND l.status = 'ok'
    )
    ORDER BY r.popularity DESC NULLS LAST
    LIMIT ${limit}
  `;
}

async function logSyncStart() {
  const rows = await sql`
    INSERT INTO xx_vip_sync_log (sync_type, source, status, started_at)
    VALUES ('xingfan', 'xingfan.cc', 'running', NOW())
    RETURNING id`;
  return rows[0]?.id;
}

async function logSyncEnd(id, status, total, success, fail, errorMsg = null) {
  await sql`
    UPDATE xx_vip_sync_log
    SET status = ${status},
        total_count = ${total},
        success_count = ${success},
        fail_count = ${fail},
        error_msg = ${errorMsg},
        finished_at = NOW(),
        duration_ms = EXTRACT(MILLISECOND FROM (NOW() - started_at))::int
    WHERE id = ${id}`;
}

// ---- 匹配一条资源 ----
async function matchOne(resource) {
  const titleToSearch = resource.title || resource.original_title;
  if (!titleToSearch) return { status: 'no_title' };

  let candidates;
  try {
    candidates = await searchXingfan(titleToSearch);
  } catch (e) {
    return { status: 'search_fail', err: e.message };
  }

  if (candidates.length === 0) return { status: 'no_candidate' };

  // debug: 列前 3 个 candidates (算分后)
  if (process.env.DEBUG) {
    const scored = candidates.slice(0, 5).map((c) => ({ ...c, s: similarity(titleToSearch, c.title) })).sort((a, b) => b.s - a.s);
    console.log(`  [${resource.id}] "${titleToSearch}" → ${candidates.length} cands, top5:`);
    scored.forEach((c) => console.log(`    ${c.s.toFixed(2)} "${c.title}" ${c.url}`));
  }

  // 找最相似
  const best = candidates
    .map((c) => ({ ...c, score: similarity(c.title, titleToSearch) }))
    .sort((a, b) => b.score - a.score)[0];

  // 阈值: 字符 Jaccard > 0.3 才算匹配 (避免完全无关)
  if (best.score < 0.3) return { status: 'low_score', score: best.score };

  // 抓详情页拿 play_urls
  let eps;
  try {
    eps = await extractPlayUrls(best.url);
  } catch (e) {
    return { status: 'detail_fail', err: e.message };
  }

  if (eps.length === 0) return { status: 'no_eps' };

  // 加 confidence
  eps.forEach((e) => (e.confidence = best.score));
  const inserted = await insertLinks(resource.id, 'xingfan', best.url, eps);
  return { status: 'ok', inserted, score: best.score, matched: best.title, eps: eps.length };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 200, concurrency: 3 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') opts.limit = parseInt(args[++i], 10);
    else if (args[i] === '--concurrency') opts.concurrency = parseInt(args[++i], 10);
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  console.log('▶ xingfan.cc 匹配启动');
  console.log('  limit:', opts.limit, 'concurrency:', opts.concurrency);
  console.log('  proxy:', HTTP_PROXY);

  const logId = await logSyncStart();
  const pending = await fetchPending(opts.limit);
  console.log(`  拿到 ${pending.length} 条待匹配资源`);

  if (pending.length === 0) {
    await logSyncEnd(logId, 'success', 0, 0, 0, '无待匹配资源');
    console.log('✅ 无待匹配');
    return;
  }

  const results = await pMap(pending, async (r) => matchOne(r), opts.concurrency);

  const summary = {
    ok: 0, no_title: 0, no_candidate: 0, low_score: 0,
    search_fail: 0, detail_fail: 0, no_eps: 0,
  };
  let totalEps = 0;
  for (const r of results) {
    summary[r.status] = (summary[r.status] || 0) + 1;
    if (r.status === 'ok') {
      totalEps += r.inserted;
    }
  }

  console.log('\n📊 统计:');
  console.log('  ✅ ok:', summary.ok, `(共入库 ${totalEps} 集)`);
  console.log('  ❌ no_candidate:', summary.no_candidate);
  console.log('  ❌ low_score:', summary.low_score);
  console.log('  ❌ no_eps:', summary.no_eps);
  console.log('  ❌ search_fail:', summary.search_fail);
  console.log('  ❌ detail_fail:', summary.detail_fail);

  const ok = summary.ok || 0;
  const fail = pending.length - ok;
  const status = fail === 0 ? 'success' : (ok > 0 ? 'partial' : 'failed');
  await logSyncEnd(logId, status, pending.length, ok, fail);

  process.exit(status === 'failed' ? 1 : 0);
}

main().catch((e) => {
  console.error('❌ 异常:', e);
  process.exit(1);
});
