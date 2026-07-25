// 看 4 条剩的副表 dmhy
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

const r = await sql`SELECT id, resource_id, source, url, sort, status FROM xx_resource_links WHERE url ILIKE '%dmhy%' ORDER BY id`;
console.log('副表 dmhy 4 条:');
console.log(JSON.stringify(r, null, 2));

process.exit(0);
