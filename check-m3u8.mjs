// 看 m3u8 状态
import { neon } from '@neondatabase/serverless';
const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
const r1 = await sql(`SELECT
  COUNT(*) FILTER (WHERE m3u8_urls IS NOT NULL)::int as has_m3u8,
  COUNT(*) FILTER (WHERE m3u8_urls IS NULL)::int as no_m3u8,
  COUNT(*)::int as total
FROM xx_vip_links WHERE play_url LIKE '%playerla%'`);
console.log('playerla 状态:', r1);
const r2 = await sql(`SELECT id, m3u8_urls FROM xx_vip_links WHERE m3u8_urls IS NOT NULL LIMIT 1`);
console.log('样本:', JSON.stringify(r2[0], null, 2));
const r3 = await sql(`SELECT COUNT(DISTINCT source) as n_distinct_sources FROM xx_vip_links l, jsonb_array_elements(l.m3u8_urls) elem WHERE l.m3u8_urls IS NOT NULL`);
console.log('m3u8 来源域名数:', r3);
