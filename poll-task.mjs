// 不调 trigger-match, 直接看 read replica lag 多久能 sync task
import { neon } from '@neondatabase/serverless';
const sql = neon(process.env.DATABASE_URL || '');

// 看 task 状态
for (let i = 0; i < 5; i++) {
  const r = await sql`SELECT id, status, total, matched, nomatch, "offset", updated_at FROM xx_match_tasks ORDER BY id DESC LIMIT 3`;
  console.log(`[t=${i}] tasks:`, JSON.stringify(r, null, 2));
  await new Promise(r => setTimeout(r, 5000));
}

process.exit(0);
