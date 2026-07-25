// 查 m3u8 真链 6 个源分布
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const s = neon(readFileSync('.env.production', 'utf-8').match(/DATABASE_URL=(.+)/)[1].trim());

// m3u8_urls 是 JSONB 数组, 形如 [{source, url, expires_at, fetched_at}]
const r1 = await s`
  SELECT l.id, l.resource_id, l.episode, l.m3u8_urls
  FROM xx_vip_links l
  WHERE l.m3u8_urls IS NOT NULL
  LIMIT 5
`;
console.log('=== 5 个有 m3u8 的样本 ===');
for (const r of r1) {
  console.log(`id=${r.id} resource_id=${r.resource_id} ep=${r.episode}`);
  if (Array.isArray(r.m3u8_urls)) {
    for (const m of r.m3u8_urls) {
      console.log(`  source=${m.source} url=${m.url?.slice(0, 100)}`);
    }
  }
}

// 统计各 source 数量
const r2 = await s`
  SELECT jsonb_array_elements(m3u8_urls)->>'source' as source, COUNT(*) as c
  FROM xx_vip_links
  WHERE m3u8_urls IS NOT NULL
  GROUP BY source
  ORDER BY c DESC
`;
console.log('=== m3u8 source 分布 ===');
console.table(r2);

// 哪些 m3u8 source 域名可能是被 115 拦的
const r3 = await s`
  SELECT DISTINCT jsonb_array_elements(m3u8_urls)->>'source' as source
  FROM xx_vip_links
  WHERE m3u8_urls IS NOT NULL
`;
console.log('=== 所有 m3u8 source 唯一值 ===');
for (const r of r3) console.log(' ', r.source);
