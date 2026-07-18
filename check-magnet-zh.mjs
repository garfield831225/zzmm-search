// 直查 search API SQL 模拟
import jwt from 'jsonwebtoken';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
const envText = readFileSync('C:/temp_zzmm/.env', 'utf-8');
const m = envText.match(/DATABASE_URL=([^\n]+)/);
const sql = neon(m[1]);

// 完全复刻 search API 的 SQL
const catFilter = '1=1';  // 没传 category
const sourceFilter = `r.source = 'magnet'`;
const nameFilter = '1=1';
const accessLevelFilter = "(r.access_level IN ('basic', 'vip', 'code'))";
const importChannelFilter = '1=1';
const sheetFilter = '1=1';
const libraryZoneFilter = "((r.import_channel IS NULL OR r.import_channel != 'zezemom_excel') AND (r.pay_type IS NULL OR r.pay_type != 'code'))";
const whereClause = `r.status = 'active' AND ${catFilter} AND ${sourceFilter} AND ${nameFilter} AND ${accessLevelFilter} AND ${importChannelFilter} AND ${sheetFilter} AND ${libraryZoneFilter}`;

console.log('WHERE:', whereClause);
const cnt = await sql.query(`SELECT COUNT(*) as c FROM xx_resources r WHERE ${whereClause}`);
console.log('Count:', cnt[0].c);

// 再试试不加 libraryZoneFilter
const cnt2 = await sql.query(`SELECT COUNT(*) as c FROM xx_resources r WHERE r.status = 'active' AND r.source = 'magnet'`);
console.log('No libraryZoneFilter:', cnt2[0].c);

// 看看 import_channel='tg_baidu' 是否在 libraryZoneFilter 里被算成 zezemom_excel
const cnt3 = await sql.query(`SELECT import_channel, COUNT(*) as c FROM xx_resources WHERE status='active' AND source='magnet' GROUP BY import_channel`);
console.log('\nimport_channel 分布:');
for (const r of cnt3) console.log(`  '${r.import_channel}': ${r.c}`);

process.exit(0);
