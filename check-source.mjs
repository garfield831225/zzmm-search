import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const result = sql`SELECT source, COUNT(*) as cnt FROM xx_resources WHERE status = 'active' GROUP BY source ORDER BY cnt DESC LIMIT 20`;
console.log(JSON.stringify(result, null, 2));