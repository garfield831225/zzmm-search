// 备份所有 playerla URL 到本地 JSON
import { neon } from '@neondatabase/serverless';
import * as fs from 'fs';

const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

const rows = await sql(`
  SELECT
    l.id, l.resource_id, l.play_url, l.season, l.episode, l.status, l.match_confidence,
    l.last_check_at, l.last_ok_at,
    r.title, r.original_title, r.media_type
  FROM xx_vip_links l
  JOIN xx_vip_resources r ON l.resource_id = r.id
  WHERE l.play_url LIKE '%playerla%'
  ORDER BY r.id, l.season, l.episode
`);

const out = {
  generated_at: new Date().toISOString(),
  count: rows.length,
  links: rows,
};

const outPath = 'C:\\temp_zzmm\\vip-playerla-backup.json';
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`备份 ${rows.length} 条到 ${outPath}`);
console.log('大小:', (fs.statSync(outPath).size / 1024).toFixed(2), 'KB');
