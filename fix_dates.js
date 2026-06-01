const { neon } = require('@neondatabase/serverless');
const s = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

(async () => {
  // 修复：把只有4位年份的release_date补成 YYYY-01-01
  const r = await s`UPDATE xx_tmdb_cache
    SET release_date = release_date || '-01-01'
    WHERE release_date ~ '^[0-9]{4}$'
    RETURNING tmdb_id, release_date`;
  console.log(`修复了 ${r.length} 条`);
  r.slice(0, 5).forEach(x => console.log(x.tmdb_id, x.release_date));
})().catch(console.error);
