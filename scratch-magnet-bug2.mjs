// 深入查 dmhy 资源, 看它们的副表链接情况
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

// 1. 找 r5 里的 id=570511, 看它的全部副链接
const r1 = await sql`
  SELECT r.id, r.name, r.source, r.category, r.import_channel, r.link, r.link_code, r.access_level, r.created_at,
    (SELECT json_agg(json_build_object('source', l.source, 'url', substring(l.url, 1, 100), 'sort', l.sort) ORDER BY l.sort)
       FROM xx_resource_links l WHERE l.resource_id = r.id) as sub_links
  FROM xx_resources r
  WHERE r.id IN (570511, 570225, 565508, 565478, 561816)
  ORDER BY r.id DESC
`;
console.log('=== r1: r5样本的完整链接情况 ===');
console.log(JSON.stringify(r1, null, 2));

// 2. 看所有主表 source=115 但主链接含 'dmhy' 的 (老问题/历史脏数据)
const r2 = await sql`
  SELECT id, name, link, source, category, import_channel, created_at
  FROM xx_resources
  WHERE source = '115'
    AND link ILIKE '%dmhy%'
  ORDER BY id DESC
  LIMIT 20
`;
console.log('\n=== r2: 主表 source=115 但 link 含 dmhy 的 (按 id 倒序) ===');
console.log(JSON.stringify(r2, null, 2));

// 3. 看 r2 里有多少条 + 最早/最晚时间
const r3 = await sql`
  SELECT COUNT(*) as cnt,
    MIN(created_at) as first,
    MAX(created_at) as last
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%'
`;
console.log('\n=== r3: dmhy 资源统计 ===');
console.log(JSON.stringify(r3, null, 2));

// 4. 看 r2 里不同时间段的分布
const r4 = await sql`
  SELECT
    CASE
      WHEN created_at > NOW() - INTERVAL '6 hours' THEN '0-6h'
      WHEN created_at > NOW() - INTERVAL '24 hours' THEN '6-24h'
      WHEN created_at > NOW() - INTERVAL '7 days' THEN '1-7d'
      ELSE '7d+'
    END as time_bucket,
    COUNT(*) as cnt
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%'
  GROUP BY time_bucket
  ORDER BY time_bucket
`;
console.log('\n=== r4: dmhy 资源时间段分布 ===');
console.log(JSON.stringify(r4, null, 2));

// 5. 看一个 dmhy 资源, 它的 source 实际应该是? 看副表
const r5 = await sql`
  SELECT r.id, r.source, r.link, l.source as sub_source, count(*) as cnt
  FROM xx_resources r
  JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.source = '115' AND r.link ILIKE '%dmhy%'
    AND l.source != '115'
  GROUP BY r.id, r.source, r.link, l.source
  ORDER BY cnt DESC
  LIMIT 30
`;
console.log('\n=== r5: dmhy 资源 副表非115的分布 ===');
console.log(JSON.stringify(r5, null, 2));

// 6. 看 share.dmhy.org 跟 115 的关系: 是不是 dmhy 主题页里的磁力被错误识别?
// 找最近 6h 的, 名字含 BT/磁力/下载 + 副表有 magnet 的
const r6 = await sql`
  SELECT r.id, r.name, r.source, r.link, r.category, r.import_channel,
    (SELECT json_agg(json_build_object('source', l.source, 'url', substring(l.url, 1, 80), 'sort', l.sort) ORDER BY l.sort)
       FROM xx_resource_links l WHERE l.resource_id = r.id) as sub_links
  FROM xx_resources r
  WHERE r.created_at > NOW() - INTERVAL '6 hours'
    AND r.source = '115'
    AND EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id = r.id AND l.source = 'magnet')
  ORDER BY r.id DESC
  LIMIT 10
`;
console.log('\n=== r6: 最近6h 主表115+副表有magnet (用户说的"磁力跑到115里") ===');
console.log(JSON.stringify(r6, null, 2));

// 7. 看 source=115 但 category="其他" 的总数
const r7 = await sql`
  SELECT
    CASE WHEN link ILIKE '%dmhy%' THEN 'dmhy'
         WHEN link ILIKE '%share.popgo.org%' THEN 'popgo'
         WHEN link ILIKE '%nyaa%' THEN 'nyaa'
         WHEN link ILIKE '%acg.rip%' THEN 'acg.rip'
         WHEN link ILIKE '%anxia%' OR link ILIKE '%115.com%' OR link ILIKE '%115cdn%' THEN 'real-115'
         ELSE 'other'
    END as link_type,
    COUNT(*) as cnt
  FROM xx_resources
  WHERE source = '115' AND category = '其他'
    AND created_at > NOW() - INTERVAL '7 days'
  GROUP BY link_type
  ORDER BY cnt DESC
`;
console.log('\n=== r7: 最近7天 source=115+其他, 实际 link 类型分布 ===');
console.log(JSON.stringify(r7, null, 2));

process.exit(0);
