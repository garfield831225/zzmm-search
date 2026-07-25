// 软删 3 条 VIP 测试数据 + 关联 xx_resource_links
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const env = readFileSync('C:/temp_zzmm/zzmm-search/.env.production', 'utf-8');
const s = neon(env.match(/DATABASE_URL=(.+)/)[1].trim());

const ids = [717105, 735212, 717773];

// 1. 先看 xx_resource_links 关联
const beforeLinks = await s`
  SELECT id, resource_id, source, url FROM xx_resource_links
  WHERE resource_id = ANY(${ids})
`;
console.log('=== 关联 xx_resource_links ===');
console.table(beforeLinks);
console.log('count:', beforeLinks.length);

// 2. 软删 xx_resources
const r1 = await s`
  UPDATE xx_resources
  SET status = 'deleted', updated_at = NOW()
  WHERE id = ANY(${ids}) AND status != 'deleted'
  RETURNING id, name, source, status
`;
console.log('=== 软删结果 ===');
console.table(r1);

// 3. 软删关联 xx_resource_links (也标 status='deleted')
const r2 = await s`
  UPDATE xx_resource_links
  SET status = 'deleted', updated_at = NOW()
  WHERE resource_id = ANY(${ids}) AND status != 'deleted'
  RETURNING id, resource_id, source
`;
console.log('=== 关联链接软删结果 ===');
console.table(r2);

// 4. 验证 VIP 区这 3 个 source 没了
const after = await s`
  SELECT source, COUNT(*) as cnt
  FROM xx_resources
  WHERE source IN ('115', 'telegra_ph', 'tianyi')
    AND access_level = 'vip'
    AND status = 'active'
  GROUP BY source
  ORDER BY source
`;
console.log('=== 删后 VIP 区 source 分布 ===');
console.log(after);
