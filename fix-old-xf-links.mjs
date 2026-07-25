// 批量转 xingfan URL → playerla URL
import { neon } from '@neondatabase/serverless';

process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

async function fetchHtml(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10000),
  });
  return await resp.text();
}

function extractPlayerInfo(html) {
  const m = html.match(/var\s+zanpiancms_player\s*=\s*(\{[^;]+\})/);
  if (!m) return null;
  try {
    const cfg = JSON.parse(m[1]);
    return { videoId: cfg.url, apiurl: cfg.apiurl };
  } catch { return null; }
}

function buildPlayerlaUrl(videoId, apiurl, episode) {
  if (!videoId) return null;
  const tpl = apiurl || '//php.playerla.com/mjplay/?id=';
  const prefix = tpl.startsWith('//') ? 'https:' : '';
  return episode ? `${prefix}${tpl}${videoId}&ep=${episode}` : `${prefix}${tpl}${videoId}`;
}

async function main() {
  // 1. 找所有 xingfan URL 的 link
  const rows = await sql(`
    SELECT id, play_url, source_url, season, episode
    FROM xx_vip_links
    WHERE play_url LIKE '%xingfan.cc%'
    ORDER BY id
  `);
  console.log('总 xingfan URL:', rows.length);

  let ok = 0, fail = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let playUrl = row.play_url;
    // 抓播放页
    let html = null;
    try {
      html = await fetchHtml(playUrl);
    } catch (e) {
      console.log(`[${i+1}/${rows.length}] ${row.id} FAIL fetch: ${e.message.slice(0, 80)}`);
      fail++;
      continue;
    }
    const info = extractPlayerInfo(html);
    if (!info || !info.videoId) {
      console.log(`[${i+1}/${rows.length}] ${row.id} NO_PLAYER_INFO`);
      fail++;
      continue;
    }
    const newUrl = buildPlayerlaUrl(info.videoId, info.apiurl, row.episode);
    if (!newUrl) {
      fail++;
      continue;
    }
    // 更新 DB
    try {
      await sql(`UPDATE xx_vip_links SET play_url = $1 WHERE id = $2`, [newUrl, row.id]);
      ok++;
      if (ok % 20 === 0) console.log(`[${i+1}/${rows.length}] 进度 ok=${ok} fail=${fail}`);
    } catch (e) {
      console.log(`[${i+1}] ${row.id} DB FAIL: ${e.message.slice(0, 80)}`);
      fail++;
    }
    // rate limit
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(`\n=== 完成: ok=${ok} fail=${fail} ===`);
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
