import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';

const sql = neon(process.env.DATABASE_URL!);

// 来源识别
function detectSource(link: string): string {
  if (!link) return '115';
  if (link.includes('115.com') || link.includes('115.cn')) return '115';
  if (link.includes('pan.baidu.com')) return 'baidu';
  if (link.includes('quark.cn')) return 'quark';
  if (link.includes('aliyundrive.com')) return 'aliyun';
  if (link.includes('123pan.com')) return '123';
  if (link.includes('cloud.189.cn')) return 'tianyi';
  if (link.includes('magnet:')) return 'magnet';
  if (link.includes('ed2k://')) return 'ed2k';
  if (link.includes('thunder:') || link.includes('xunlei')) return 'thunder';
  return '115';
}

// 分类映射
function mapCategory(category: string): string {
  const cat = (category || '').toLowerCase();
  if (cat.includes('电影')) return '电影';
  if (cat.includes('剧集') || cat.includes('电视剧')) return '剧集';
  if (cat.includes('动漫') || cat.includes('动画')) return '动漫';
  if (cat.includes('综艺')) return '综艺';
  if (cat.includes('音乐')) return '音乐';
  if (cat.includes('纪录片')) return '纪录片';
  if (cat.includes('学习') || cat.includes('教程')) return '学习资料';
  return '其他';
}

async function importData() {
  console.log('📖 读取JSON文件...');
  const raw = readFileSync('./zzmm_data_compact.json', 'utf8');
  const data = JSON.parse(raw);
  const items = data.d || [];
  console.log(`📊 共 ${items.length} 条数据`);

  // 清理旧数据
  console.log('🗑️ 清理旧数据...');
  await sql`TRUNCATE xx_resources RESTART IDENTITY`;

  // 批量插入
  const BATCH = 500;
  let imported = 0;

  console.log('⬆️ 开始导入...');
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const values = batch.map((item: any) => [
      item.n || '',
      item.l || '',
      item.c || '',
      detectSource(item.l || ''),
      mapCategory(item.g || ''),
      item.s || ''
    ]);

    try {
      for (const row of values) {
        await sql`
          INSERT INTO xx_resources (name, link, link_code, source, category, size, tags, status, valid_status, view_count, created_at, updated_at)
          VALUES (${row[0]}, ${row[1]}, ${row[2]}, ${row[3]}, ${row[4]}, ${row[5]}, '{}', 'active', 'unchecked', 0, NOW(), NOW())
        `;
      }
      imported += batch.length;
      console.log(`  ✅ ${imported}/${items.length}`);
    } catch (err) {
      console.error(`  ❌ 批次 ${i/BATCH + 1} 失败:`, err);
    }
  }

  console.log(`\n🎉 导入完成！共 ${imported} 条`);

  // 统计
  const stats = await sql`
    SELECT category, COUNT(*) as count
    FROM xx_resources
    GROUP BY category
    ORDER BY count DESC
  `;
  console.log('\n📊 分类统计:');
  stats.forEach((row: any) => console.log(`  ${row.category}: ${row.count}`));
}

importData().catch(console.error);