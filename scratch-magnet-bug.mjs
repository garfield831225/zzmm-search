// 查最近 6h 的 TG 资源, source=115 但实际是磁力的
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || '');

// 1. 最近 6h 内, 主表 source=115 但主链接是 magnet 的
const r1 = await sql`
  SELECT id, name, link, source, category, import_channel, access_level, created_at
  FROM xx_resources
  WHERE created_at > NOW() - INTERVAL '6 hours'
    AND source = '115'
    AND (link LIKE 'magnet:%' OR link LIKE 'thunder:%')
  ORDER BY id DESC
  LIMIT 30
`;
console.log('=== r1: 最近6h 主表source=115但link是magnet/thunder ===');
console.log(JSON.stringify(r1, null, 2));

// 2. 最近 6h 内, 副表 source=magnet 但主表 source=115 的
const r2 = await sql`
  SELECT r.id, r.name, r.source as main_source, r.category, r.created_at,
    l.id as link_id, l.source as link_source, l.url, l.sort
  FROM xx_resources r
  JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.created_at > NOW() - INTERVAL '6 hours'
    AND r.source = '115'
    AND l.source = 'magnet'
  ORDER BY r.id DESC
  LIMIT 20
`;
console.log('=== r2: 最近6h 主表115+副表magnet (1对N) ===');
console.log(JSON.stringify(r2, null, 2));

// 3. 副表 source=magnet 但主表 source 不是 magnet 的分布
const r3 = await sql`
  SELECT r.source as main_source, r.category, COUNT(*) as cnt
  FROM xx_resources r
  JOIN xx_resource_links l ON l.resource_id = r.id
  WHERE r.created_at > NOW() - INTERVAL '6 hours'
    AND l.source = 'magnet'
  GROUP BY r.source, r.category
  ORDER BY cnt DESC
`;
console.log('=== r3: 最近6h 副表magnet资源的主表source分布 ===');
console.log(JSON.stringify(r3, null, 2));

// 4. 全部主表 source=magnet 的 (总览)
const r4 = await sql`
  SELECT id, name, source, category, import_channel, link, created_at
  FROM xx_resources
  WHERE source = 'magnet'
  ORDER BY id DESC
  LIMIT 30
`;
console.log('=== r4: 全部 source=magnet 主表资源 (最近30) ===');
console.log(JSON.stringify(r4, null, 2));

// 5. 看 source=115 但名字/类目像磁力的 (BT, 种子, 下载, 磁力)
const r5 = await sql`
  SELECT id, name, source, category, import_channel, link, created_at
  FROM xx_resources
  WHERE created_at > NOW() - INTERVAL '6 hours'
    AND source = '115'
    AND (name ILIKE '%磁力%' OR name ILIKE '%BT%' OR name ILIKE '%种子%' OR name ILIKE '%下载%' OR name ILIKE '%magnet%')
  ORDER BY id DESC
  LIMIT 30
`;
console.log('=== r5: 最近6h source=115但名字像磁力的 ===');
console.log(JSON.stringify(r5, null, 2));

// 6. 看 category=磁力 的资源, 都是什么 source
const r6 = await sql`
  SELECT source, COUNT(*) as cnt
  FROM xx_resources
  WHERE category = '磁力'
  GROUP BY source
  ORDER BY cnt DESC
`;
console.log('=== r6: category=磁力 的 source 分布 ===');
console.log(JSON.stringify(r6, null, 2));

// 7. 看一个最可能"错配"的: 名字像磁力但 source=115 的几条 + 它们副表情况
const r7 = await sql`
  SELECT r.id, r.name, r.source, r.category, r.link, r.created_at,
    (SELECT json_agg(json_build_object('source', l.source, 'url', substring(l.url, 1, 80), 'sort', l.sort))
       FROM xx_resource_links l WHERE l.resource_id = r.id) as sub_links
  FROM xx_resources r
  WHERE r.created_at > NOW() - INTERVAL '6 hours'
    AND r.source = '115'
    AND (r.name ILIKE '%磁力%' OR r.name ILIKE '%BT%' OR r.name ILIKE '%种子%' OR r.name ILIKE '%下载%' OR r.name ILIKE '%magnet%')
  ORDER BY r.id DESC
  LIMIT 5
`;
console.log('=== r7: source=115但名字像磁力, + 副表 ===');
console.log(JSON.stringify(r7, null, 2));

process.exit(0);
