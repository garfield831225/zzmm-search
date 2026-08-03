// 查 dmhy 资源实际链接情况, 看有没有磁力被丢
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

// 1. dmhy 资源, 它们副表 source 分布
const r1 = await sql`
  SELECT l.source, COUNT(*) as cnt
  FROM xx_resources r
  LEFT JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.source = '115' AND r.link ILIKE '%dmhy%'
  GROUP BY l.source
  ORDER BY cnt DESC
`;
console.log('=== r1: dmhy资源 副表source分布 ===');
console.log(JSON.stringify(r1, null, 2));

// 2. dmhy 资源里, 副表有 magnet 吗
const r2 = await sql`
  SELECT COUNT(DISTINCT r.id) as cnt
  FROM xx_resources r
  JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.source = '115' AND r.link ILIKE '%dmhy%'
    AND l.source = 'magnet'
`;
console.log('\n=== r2: dmhy资源 副表有magnet的数 ===');
console.log(JSON.stringify(r2, null, 2));

// 3. dmhy 资源里, 主表 link 是 magnet 吗
const r3 = await sql`
  SELECT COUNT(*) as cnt
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%' AND (link LIKE 'magnet:%' OR link LIKE 'thunder:%')
`;
console.log('\n=== r3: dmhy资源主表link是magnet的数 ===');
console.log(JSON.stringify(r3, null, 2));

// 4. 看一个 dmhy 资源的副表, 有没有 115/夸克/百度 等
const r4 = await sql`
  SELECT resource_id, source, url, sort
  FROM xx_resource_links
  WHERE resource_id = 570511
  ORDER BY sort
`;
console.log('\n=== r4: 570511 的副表 ===');
console.log(JSON.stringify(r4, null, 2));

// 5. 取一条 r.id 在 441983 附近的资源, 看完整情况
const r5 = await sql`
  SELECT r.id, r.name, r.source, r.link, r.category, r.created_at,
    (SELECT json_agg(json_build_object('source', l.source, 'url', substring(l.url, 1, 80), 'sort', l.sort) ORDER BY l.sort)
       FROM xx_resource_links l WHERE l.resource_id = r.id) as sub_links
  FROM xx_resources r
  WHERE r.id = 441983
`;
console.log('\n=== r5: 441983 完整情况 ===');
console.log(JSON.stringify(r5, null, 2));

// 6. 看是不是所有 123,955 条 dmhy 都是 source=115 + 实际是导航站
//    按 id 范围 分批看 (441983 最早, 571322 最晚)
const r6 = await sql`
  SELECT
    (COUNT(*) FILTER (WHERE link LIKE 'magnet:%' OR link LIKE 'thunder:%')) as dmhy_with_magnet,
    (COUNT(*) FILTER (WHERE link ILIKE '%115.com%' OR link ILIKE '%anxia%')) as dmhy_with_115,
    (COUNT(*) FILTER (WHERE link ILIKE '%baidu%')) as dmhy_with_baidu,
    (COUNT(*) FILTER (WHERE link ILIKE '%quark%')) as dmhy_with_quark,
    (COUNT(*) FILTER (WHERE link ILIKE '%dmhy%' AND link NOT LIKE 'magnet:%' AND link NOT LIKE 'thunder:%' AND link NOT ILIKE '%115.com%' AND link NOT ILIKE '%anxia%' AND link NOT ILIKE '%baidu%' AND link NOT ILIKE '%quark%')) as pure_dmhy_nav,
    COUNT(*) as total
  FROM xx_resources
  WHERE source = '115' AND link ILIKE '%dmhy%'
`;
console.log('\n=== r6: dmhy 资源细分 (磁力/115/百度/夸克/纯导航) ===');
console.log(JSON.stringify(r6, null, 2));

// 7. 看 123,955 条 dmhy 中, 副表数 = 0 的 (没有任何真链接) 有多少
const r7 = await sql`
  SELECT COUNT(*) as cnt
  FROM xx_resources r
  WHERE r.source = '115' AND r.link ILIKE '%dmhy%'
    AND NOT EXISTS (SELECT 1 FROM xx_resource_links l WHERE l.resource_id = r.id)
`;
console.log('\n=== r7: dmhy资源 副表为0的 (纯导航) ===');
console.log(JSON.stringify(r7, null, 2));

// 8. 看看是不是 sort=1 的副表 url 跟主表 link 一样 (sort=1 回填时的产物)
const r8 = await sql`
  SELECT COUNT(*) as cnt
  FROM xx_resources r
  JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.source = '115' AND r.link ILIKE '%dmhy%'
    AND l.source = '115' AND l.url ILIKE '%dmhy%'
    AND l.sort = 1
`;
console.log('\n=== r8: 副表 sort=1 + source=115 + url是dmhy的 (回填产物) ===');
console.log(JSON.stringify(r8, null, 2));

// 9. 看 副表 sort=99 的 dmhy 是怎么来的 (跟 sort=1 不一样的批)
const r9 = await sql`
  SELECT sort, COUNT(*) as cnt
  FROM xx_resource_links
  WHERE source = '115' AND url ILIKE '%dmhy%'
  GROUP BY sort
  ORDER BY sort
`;
console.log('\n=== r9: 副表 dmhy 资源 sort 分布 ===');
console.log(JSON.stringify(r9, null, 2));

process.exit(0);
