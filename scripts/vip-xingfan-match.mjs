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

// ---- 标题相似度 (2026-07-24 改: token 子串匹配, 跨语言也能匹配) ----
// 拆搜索词成 token (按空格/标点), 只要候选 title 含 ≥ 50% token 就算匹配
// 适合: "Moana" 匹配 "海洋奇缘" (跨语言)
//      "The Odyssey" 匹配 "奥德赛" (transliteration 命中)
//      "Hello World" 匹配 "Hello World 2000" (部分 token 命中)
// 2026-07-24 改: xingfan 搜 "Moana" 返 "海洋奇缘" 但 score 0, 因为 token 不命中
//   兜底: 候选 URL slug 也算 (拼音), 但 slug 跟英文也难匹配
//   最终: 信任 xingfan 搜索相关性, candidates 第一个就给 0.5 (前提 title 不是纯数字/空)
function similarity(a, b) {
  if (!a || !b) return 0;
  const aLow = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const bLow = b.toLowerCase().replace(/\s+/g, ' ').trim();
  // 直接包含: 0.9
  if (bLow.includes(aLow) || aLow.includes(bLow)) return 0.9;
  // 拆 token 比
  const tokensA = aLow.split(/[\s\-_:,.，。！？!?,;'"()]+/).filter((t) => t.length >= 2);
  const tokensB = bLow.split(/[\s\-_:,.，。！？!?,;'"()]+/).filter((t) => t.length >= 2);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  let hit = 0;
  for (const ta of tokensA) {
    if (tokensB.some((tb) => tb.includes(ta) || ta.includes(tb))) hit++;
  }
  return hit / tokensA.length;
}

// ---- 从详情页抓所有 play_url (2026-07-24: 直接拼 playerla 第三方播放器, 不嵌 xingfan 整个丑页) ----
// 流程: fetch 详情页 → 找所有 episode-link (/1-1.html, /1-2.html) → 每个 episode 拼完整 URL
//   同时 fetch 第一个播放页 (/1-1.html) → 抓 var zanpiancms_player → 拿 videoId
//   入库 playUrl = https://php.playerla.com/mjplay/?id={videoId} (干净播放器, 无派拉蒙 logo)
async function extractPlayUrls(detailUrl) {
  const html = await xfFetch(detailUrl);
  if (!html) return [];

  const $ = cheerio.load(html);
  const eps = [];

  // 1. 抓 zanpiancms_player (如果详情页本身是播放页, 即 URL 已经是 /1-1.html)
  const playerMatch = html.match(/var\s+zanpiancms_player\s*=\s*(\{[^;]+\})/);
  let playerUrlTpl = '//php.playerla.com/mjplay/?id=';
  let videoId = '';
  if (playerMatch) {
    try {
      const cfg = JSON.parse(playerMatch[1]);
      if (cfg.url) videoId = cfg.url;
      if (cfg.apiurl) playerUrlTpl = cfg.apiurl;
    } catch {}
  }

  // 2. 抓所有 episode-link
  const epHrefs = [];
  $('.episode-link').each((_, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/(\d+)-(\d+)\.html$/);
    if (m) {
      epHrefs.push({
        season: parseInt(m[1], 10),
        episode: parseInt(m[2], 10),
        fullHref: href.startsWith('http') ? href : `${XINGFAN_BASE}${href}`,
      });
    }
  });

  // 3. 如果详情页没 videoId, 但有 episode-link, fetch 第一个播放页拿 videoId
  if (!videoId && epHrefs.length > 0) {
    try {
      const firstPlayHtml = await xfFetch(epHrefs[0].fullHref);
      if (firstPlayHtml) {
        const m = firstPlayHtml.match(/var\s+zanpiancms_player\s*=\s*(\{[^;]+\})/);
        if (m) {
          try {
            const cfg = JSON.parse(m[1]);
            if (cfg.url) videoId = cfg.url;
            if (cfg.apiurl) playerUrlTpl = cfg.apiurl;
          } catch {}
        }
      }
    } catch {}
  }

  // 4. 拼 playUrl: 优先 playerla 模板
  for (const ep of epHrefs) {
    const playUrl = videoId
      ? `${playerUrlTpl.startsWith('//') ? 'https:' : ''}${playerUrlTpl}${videoId}&ep=${ep.episode}`
      : ep.fullHref;
    eps.push({
      season: ep.season,
      episode: ep.episode,
      playUrl,
    });
  }

  // 5. 电影单集 (没 episode-link 但详情页有 videoId)
  if (eps.length === 0 && videoId) {
    const m = detailUrl.match(/(\d+)-(\d+)\.html$/);
    const season = m ? parseInt(m[1], 10) : 1;
    const episode = m ? parseInt(m[2], 10) : 1;
    const playUrl = `${playerUrlTpl.startsWith('//') ? 'https:' : ''}${playerUrlTpl}${videoId}`;
    eps.push({ season, episode, playUrl });
  }

  // 6. 兜底 (什么都没抓到)
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
  // 2026-07-24: 优先用 original_title (英文) 搜, xingfan 对英文标题匹配更准
  // 中文 title 作为 fallback
  const titlesToTry = [resource.original_title, resource.title].filter(Boolean);
  if (titlesToTry.length === 0) return { status: 'no_title' };

  let candidates;
  let titleToSearch = '';
  for (const t of titlesToTry) {
    titleToSearch = t;
    try {
      candidates = await searchXingfan(t);
    } catch (e) {
      return { status: 'search_fail', err: e.message };
    }
    if (candidates.length > 0) break;  // 第一个有结果的就用
  }

  if (candidates.length === 0) return { status: 'no_candidate' };

  // debug: 列前 3 个 candidates (算分后)
  if (process.env.DEBUG) {
    const scored = candidates.slice(0, 5).map((c) => ({ ...c, s: similarity(titleToSearch, c.title) })).sort((a, b) => b.s - a.s);
    console.log(`  [${resource.id}] "${titleToSearch}" → ${candidates.length} cands, top5:`);
    scored.forEach((c) => console.log(`    ${c.s.toFixed(2)} "${c.title}" ${c.url}`));
  }

  // 找最相似
  // 2026-07-24 改: 如果所有 candidate score 都 < 0.4 (跨语言匹配), 信任 xingfan 搜索顺序, 用第一个
  const scored = candidates
    .map((c) => ({ ...c, score: similarity(c.title, titleToSearch) }));
  let best = scored.sort((a, b) => b.score - a.score)[0];
  if (best.score < 0.4 && candidates.length > 0) {
    // 跨语言 fallback: xingfan 自己知道相关性, 用第一个 candidate
    // 但要排除纯数字/空的 title
    const firstValid = candidates.find((c) => c.title && c.title.length >= 2 && !/^\d+$/.test(c.title));
    if (firstValid) {
      best = { ...firstValid, score: 0.5 };
      if (process.env.DEBUG) console.log(`    [fallback] 用 xingfan 第一个: ${firstValid.title} (跨语言 trust)`);
    }
  }

  // 阈值: token 命中率 > 0.4 或 fallback 0.5
  if (best.score < 0.4) return { status: 'low_score', score: best.score };

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
