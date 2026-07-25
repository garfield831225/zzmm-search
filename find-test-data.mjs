// 找 VIP 区 3 条测试数据
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8');
const s = neon(env.match(/DATABASE_URL=(.+)/)[1].trim());

// VIP 区是 section='vip' + access_level='vip'
// 但 user 说的"测试"应该是某个 source 只有 1 条的那些
// 115网盘 1 / telegra_ph 1 / 天翼云盘 1
// 看 source 分布找 1 条的
const r = await s`
  SELECT id, name, category, source, access_level, import_channel, status, created_at
  FROM xx_resources
  WHERE source IN ('115', 'telegra_ph', 'tianyi')
    AND access_level = 'vip'
    AND status = 'active'
  ORDER BY source, id
`;
console.log('=== VIP 区 source IN (115/telegra_ph/tianyi) 的所有资源 ===');
console.table(r);
console.log('total:', r.length);
