// 修最后 1 条 + 再次跑剩余 xingfan
import { neon } from '@neondatabase/serverless';
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

const rows = await sql(`SELECT id, play_url, season, episode FROM xx_vip_links WHERE play_url LIKE '%xingfan.cc%' ORDER BY id`);
console.log('剩余 xingfan:', rows.length);

async function fetchHtml(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
  return await r.text();
}

for (const row of rows) {
  console.log(`\n处理 ${row.id}: ${row.play_url}`);
  let html;
  try { html = await fetchHtml(row.play_url); } catch (e) { console.log('  fetch FAIL:', e.message); continue; }
  const m = html.match(/var\s+zanpiancms_player\s*=\s*(\{[^;]+\})/);
  if (!m) { console.log('  NO_PLAYER_INFO'); continue; }
  let cfg;
  try { cfg = JSON.parse(m[1]); } catch { console.log('  JSON FAIL'); continue; }
  if (!cfg.url) { console.log('  NO URL FIELD'); continue; }
  const apiurl = cfg.apiurl || '//php.playerla.com/mjplay/?id=';
  const prefix = apiurl.startsWith('//') ? 'https:' : '';
  const newUrl = row.episode ? `${prefix}${apiurl}${cfg.url}&ep=${row.episode}` : `${prefix}${apiurl}${cfg.url}`;
  console.log(`  → ${newUrl}`);
  await sql(`UPDATE xx_vip_links SET play_url = $1 WHERE id = $2`, [newUrl, row.id]);
  console.log('  ✓');
}

// 看最终
const final = await sql(`SELECT url_type, COUNT(*)::int as n FROM (
  SELECT CASE WHEN play_url LIKE '%playerla%' THEN 'playerla' WHEN play_url LIKE '%xingfan%' THEN 'xingfan' ELSE 'other' END AS url_type
  FROM xx_vip_links
) t GROUP BY url_type`);
console.log('\n=== 最终 ===');
console.log(final);
