// 批量抓 playerla HTML 提取 m3u8 URL, 存到 xx_vip_links.m3u8_urls
// 2026-07-24: 用户担心第三方源被锁, 提前抓真链备份
import { neon } from '@neondatabase/serverless';

process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xingfan.cc/' },
    signal: AbortSignal.timeout(15000),
  });
  return await r.text();
}

// 从 playerla HTML 提取所有 m3u8
function extractM3u8(html) {
  const list = [];
  // 匹配: https://.../.../xxx.m3u8?token=...&expires=... 或 裸 m3u8
  const matches = [...html.matchAll(/(https?:\/\/[^"'<>\s]*?\.m3u8(?:\?[^"'<>\s]*)?)/gi)];
  const seen = new Set();
  for (const m of matches) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);
    // 解析 expires
    let expiresAt = null;
    const expM = url.match(/[?&]expires=(\d+)/);
    if (expM) expiresAt = new Date(parseInt(expM[1]) * 1000).toISOString();
    // 域名作为 source
    let source = 'unknown';
    try {
      const host = new URL(url).hostname;
      source = host.replace(/^www\./, '').replace(/\.[^.]+$/, '');
    } catch {}
    list.push({ source, url, expires_at: expiresAt });
  }
  return list;
}

async function main() {
  const limit = parseInt(process.env.LIMIT || '200', 10);
  // 找还没抓 m3u8 的 link
  const rows = await sql(`
    SELECT id, play_url
    FROM xx_vip_links
    WHERE play_url LIKE '%playerla%'
      AND m3u8_urls IS NULL
    ORDER BY id
    LIMIT ${limit}
  `);
  console.log(`待抓 m3u8: ${rows.length} (limit=${limit})`);

  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const html = await fetchHtml(row.play_url);
      const m3u8s = extractM3u8(html);
      if (m3u8s.length > 0) {
        await sql(`UPDATE xx_vip_links SET m3u8_urls = $1::jsonb, m3u8_fetched_at = NOW() WHERE id = $2`, [JSON.stringify(m3u8s), row.id]);
        ok++;
        if (ok % 20 === 0 || i < 5) {
          console.log(`[${i+1}/${rows.length}] ${row.id} 抓到 ${m3u8s.length} 条 m3u8 (例: ${m3u8s[0].source})`);
        }
      } else {
        fail++;
        if (fail < 5) console.log(`[${i+1}] ${row.id} NO_M3U8_IN_HTML`);
      }
    } catch (e) {
      fail++;
      if (fail < 5) console.log(`[${i+1}] ${row.id} FETCH FAIL: ${e.message.slice(0, 80)}`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`\n=== 完成: ok=${ok} fail=${fail} ===`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
