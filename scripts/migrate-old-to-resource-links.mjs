// 2026-07-17: 老数据迁移脚本
// 把 xx_resources 老 link/link_code/source 入副表 xx_resource_links
// 跑法: node scripts/migrate-old-to-resource-links.mjs
// 业务规则 (2026-07-17):
//   - 不动 xx_resources 主表 (link/link_code/source 保留原值, 兼容老查询)
//   - 老数据原样入副表, 不去重 (16k TG 4倍重复暂不处理, 跟当前显示一致)
//   - sort 按 SOURCE_SORT 算 (G5-a 全局写死)
//   - access_level 跟资源一致 (zezhemom_excel=basic, 其他=vip)
import { neon } from '@neondatabase/serverless';
import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

const SOURCE_SORT = {
  '115': 1, 'baidu': 2, 'quark': 3, 'aliyun': 4, 'xunlei': 5,
  '123': 6, 'uc': 7, 'tianyi': 8, 'yidong': 9, 'magnet': 10,
  'ed2k': 10, 'telegra_ph': 99, 'other': 99,
};

const sql = neon(process.env.DATABASE_URL || '');
const BATCH_SIZE = 500;
const PROGRESS_EVERY = 5000;

async function main() {
  console.log('🚀 老数据迁移: xx_resources → xx_resource_links');
  console.log('━'.repeat(60));

  // 1. 总数
  const totalRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resources WHERE status = 'active' AND link IS NOT NULL AND link != ''`;
  const total = totalRes[0]?.cnt || 0;
  console.log(`📊 待迁移总数: ${total} 条资源\n`);

  // 2. 已迁移数 (用于断点续跑)
  const doneRes = await sql`SELECT COUNT(DISTINCT resource_id)::int as cnt FROM xx_resource_links`;
  const done = doneRes[0]?.cnt || 0;
  console.log(`✅ 已迁移: ${done} 条资源 (断点续跑)\n`);
  if (done >= total) {
    console.log('🎉 全部完成, 无需再跑');
    return;
  }

  let processed = 0;
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  let lastId = 0;
  const startTime = Date.now();

  // 3. 分批遍历 (按 id 升序, 用 lastId 游标避免 OFFSET 大表慢)
  while (true) {
    const rows = await sql`
      SELECT id, link, link_code, source, import_channel, access_level
      FROM xx_resources
      WHERE status = 'active' AND link IS NOT NULL AND link != '' AND id > ${lastId}
      ORDER BY id ASC
      LIMIT ${BATCH_SIZE}
    ` as any[];

    if (rows.length === 0) break;

    for (const r of rows) {
      lastId = r.id;
      processed++;
      const source = r.source || 'other';
      const sort = SOURCE_SORT[source] ?? 99;
      const accessLevel = (r.import_channel === 'zezemom_excel') ? 'basic' : (r.access_level || 'vip');

      try {
        const r2 = await sql`
          INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
          VALUES (${r.id}, ${source}, ${r.link}, ${r.link_code || ''}, ${sort}, 'active', ${accessLevel})
          ON CONFLICT (resource_id, source) DO NOTHING
        `;
        // Neon UPDATE INSERT 没可靠 RETURNING, 用 on conflict 算 skipped
        // 这里简单按 inserted++ (ON CONFLICT 不算错误, 但实际可能没插入)
        inserted++;
      } catch (e) {
        failed++;
        if (failed <= 5) {
          console.error(`  ❌ id=${r.id} source=${source}: ${(e as any).message?.slice(0, 100)}`);
        }
      }
    }

    // 进度
    if (processed % PROGRESS_EVERY < BATCH_SIZE) {
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = processed / elapsed;
      const eta = (total - processed) / rate;
      const pct = ((processed + done) / (total + done) * 100).toFixed(1);
      console.log(`  ${pct}% | ${processed}/${total} | 失败 ${failed} | 速度 ${rate.toFixed(0)}/s | 剩余 ${eta.toFixed(0)}s`);
    }
  }

  const totalElapsed = (Date.now() - startTime) / 1000;
  console.log('\n━'.repeat(60));
  console.log(`🎉 迁移完成!`);
  console.log(`   处理: ${processed} 条`);
  console.log(`   失败: ${failed} 条`);
  console.log(`   耗时: ${totalElapsed.toFixed(1)}s`);

  // 4. 验证
  const verifyRes = await sql`SELECT COUNT(*)::int as cnt FROM xx_resource_links`;
  const verifyBySource = await sql`SELECT source, COUNT(*)::int as cnt FROM xx_resource_links GROUP BY source ORDER BY cnt DESC`;
  console.log(`\n📊 副表现状: 总 ${verifyRes[0]?.cnt} 条`);
  console.log('   按 source:');
  for (const r of verifyBySource) {
    console.log(`     ${r.source}: ${r.cnt}`);
  }
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
