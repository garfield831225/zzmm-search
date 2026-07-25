// 清理剩下 3 条副表 dmhy 链接 + 验证
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

const ids = [295764, 308812, 329039];

for (const id of ids) {
  try {
    await sql`DELETE FROM xx_resource_links WHERE id = ${id}`;
    console.log(`deleted sub link id=${id}`);
  } catch (e) { console.log(`err ${id}: ${e.message}`); }
}

// 看 resource_id 509612/522652/542863 主表 status
const r = await sql`SELECT id, source, link, name FROM xx_resources WHERE id IN (509612, 522652, 542863)`;
console.log('main table for these 3:');
console.log(JSON.stringify(r, null, 2));

// 最后 verify
const r2 = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links WHERE url ILIKE '%dmhy%'`;
console.log('副表 dmhy 链接 final:', r2[0]?.cnt);

// 顺手扫一下 url 含 dmhy 但 source 不是 115 的
const r3 = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resource_links WHERE url ILIKE '%dmhy%' GROUP BY source`;
console.log('副表 dmhy 按 source:', r3);

process.exit(0);
