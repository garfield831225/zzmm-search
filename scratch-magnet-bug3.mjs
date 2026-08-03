// 深入: 时间分布 + 找真 bug 原因
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

// 1. 时间分布
const r1 = await sql`
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
console.log('=== r1: dmhy资源 时间分布 ===');
console.log(JSON.stringify(r1, null, 2));

// 2. 副表也有 dmhy 链接且 source=115 的
const r2 = await sql`
  SELECT COUNT(*) as cnt
  FROM xx_resource_links
  WHERE source = '115' AND url ILIKE '%dmhy%'
`;
console.log('\n=== r2: 副表 source=115 但 url 是 dmhy 的总数 ===');
console.log(JSON.stringify(r2, null, 2));

// 3. 副表 sample 一条, 看是不是 sort=1 + url 是 dmhy
const r3 = await sql`
  SELECT resource_id, source, url, sort, status, access_level, created_at
  FROM xx_resource_links
  WHERE source = '115' AND url ILIKE '%dmhy%'
  ORDER BY id DESC
  LIMIT 5
`;
console.log('\n=== r3: 副表 dmhy 资源 sample ===');
console.log(JSON.stringify(r3, null, 2));

// 4. 看看主表 source=115 的, 里面 link 是 http 开头的 (非 115/anxia 域), 这种是不是 bug
const r4 = await sql`
  SELECT
    CASE
      WHEN link ILIKE '%115.com%' OR link ILIKE '%anxia.com%' OR link ILIKE '%115cdn%' THEN 'real-115-domain'
      WHEN link ILIKE '%dmhy%' THEN 'dmhy'
      WHEN link ILIKE '%nyaa%' OR link ILIKE '%acg.rip%' THEN 'other-anime-bt'
      WHEN link ILIKE '%share.popgo%' OR link ILIKE '%bangumi%' OR link ILIKE '%acgnx%' THEN 'other-bt'
      WHEN link ILIKE '%magnet%' THEN 'magnet-as-115'
      WHEN link ILIKE '%baidu%' THEN 'baidu-as-115'
      WHEN link ILIKE '%quark%' THEN 'quark-as-115'
      ELSE 'unknown'
    END as link_type,
    COUNT(*) as cnt
  FROM xx_resources
  WHERE source = '115' AND category = '其他'
  GROUP BY link_type
  ORDER BY cnt DESC
`;
console.log('\n=== r4: source=115+其他, link 类型 ===');
console.log(JSON.stringify(r4, null, 2));

// 5. 看最近 6h 的 dmhy 资源, 它们 id 范围
const r5 = await sql`
  SELECT MIN(id) as min_id, MAX(id) as max_id, COUNT(*) as cnt
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%'
    AND created_at > NOW() - INTERVAL '6 hours'
`;
console.log('\n=== r5: 最近6h dmhy 资源 id 范围 ===');
console.log(JSON.stringify(r5, null, 2));

// 6. 对比: 总共 source=115 是多少, dmhy 占多少
const r6 = await sql`
  SELECT
    (SELECT COUNT(*) FROM xx_resources WHERE source = '115') as total_115,
    (SELECT COUNT(*) FROM xx_resources WHERE source = '115' AND link ILIKE '%dmhy%') as dmhy_in_115,
    (SELECT COUNT(*) FROM xx_resources WHERE link ILIKE '%dmhy%') as dmhy_total
`;
console.log('\n=== r6: 总数对比 ===');
console.log(JSON.stringify(r6, null, 2));

// 7. 找历史: 什么时候开始有 dmhy 资源的? (按 created_at 升序)
const r7 = await sql`
  SELECT id, name, link, source, created_at
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%'
  ORDER BY id ASC
  LIMIT 3
`;
console.log('\n=== r7: 最早 dmhy 资源 ===');
console.log(JSON.stringify(r7, null, 2));

// 8. 看 r2 里的 sort=99 是怎么来的 (正常应该 source 跟主表一致, 但如果主表 source='115' 是错的...)
const r8 = await sql`
  SELECT id, source, url, sort, status, access_level, created_at, resource_id
  FROM xx_resource_links
  WHERE source = '115' AND url ILIKE '%dmhy%'
  ORDER BY id ASC
  LIMIT 3
`;
console.log('\n=== r8: 最早的副表 dmhy 资源 (按 id 升序) ===');
console.log(JSON.stringify(r8, null, 2));

process.exit(0);
