const { neon } = require('@neondatabase/serverless');

const TMDB_KEYS = ['7985342d5961e9ee3d5ef6d969c1b8dd', '79e41efe870e60afb09b9de8baa47cf1'];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';

const sql = neon('postgresql://neondb_owner:npg_2KcMmEWjnXd3@ep-misty-resonance-aoiefatw.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function getKey(idx) { return TMDB_KEYS[idx % TMDB_KEYS.length]; }

function cleanName(raw) {
  if (!raw) return '';
  return raw.replace(/\.(mp4|mkv|avi|mov|wmv|flv|webm|ts|rmvb|part)/i, '')
    .replace(/\[.*?\]|\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

function subTypeToType(subType) {
  if (!subType) return 'movie';
  const s = (subType || '').toLowerCase();
  if (['剧集','韩剧','欧美剧','港台剧','国产剧','日剧'].some(t => s.includes(t))) return 'tv';
  return 'movie';
}

async function searchTmdb(name, type, year, keyIdx) {
  const key = getKey(keyIdx);
  const ep = type === 'tv' ? '/search/tv' : '/search/movie';
  const yp = type === 'tv' ? 'first_air_date_year' : 'primary_release_year';
  let url = `${TMDB_BASE}${ep}?query=${encodeURIComponent(name)}&api_key=${key}&language=zh-CN&page=1&include_adult=false`;
  if (year) url += `&${yp}=${year}`;
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    const d = await r.json();
    return d.results?.[0] || null;
  } catch { return null; }
}

async function cacheAndUpdate(resourceId, result, type) {
  const year = (result.release_date || result.first_air_date || '').slice(0, 4);
  const title = result.title || result.name || '';
  const poster = result.poster_path ? TMDB_IMG + result.poster_path : '';
  const vote = result.vote_average || 0;
  const origTitle = result.original_title || '';

  // insert/update tmdb_cache
  await sql`
    INSERT INTO xx_tmdb_cache (tmdb_id, tmdb_type, title, original_title, poster_path, vote_average, vote_count, release_date, cached_at)
    VALUES (${result.id}, ${type}, ${title}, ${origTitle || null}, ${poster || null}, ${vote}, ${result.vote_count || 0}, ${year || null}, NOW())
    ON CONFLICT (tmdb_id) DO UPDATE SET
      title = EXCLUDED.title,
      poster_path = COALESCE(EXCLUDED.poster_path, xx_tmdb_cache.poster_path),
      vote_average = EXCLUDED.vote_average,
      vote_count = EXCLUDED.vote_count,
      cached_at = NOW()
  `;

  // update resource
  await sql`UPDATE xx_resources SET tmdb_id = ${String(result.id)} WHERE id = ${resourceId}`;
}

async function matchOne(name, category, subType) {
  const clean = cleanName(name);
  if (clean.length < 2) return null;

  // extract year from name like "xxx 2023"
  const yearMatch = clean.match(/\b(19\d2|20\d2)\b/);
  const year = yearMatch ? yearMatch[1] : null;

  const type = subType ? subTypeToType(subType) : 'movie';
  let idx = 0;

  // zh-CN first
  await sleep(50);
  let r = await searchTmdb(clean, type, year, idx++);
  if (r) return { result: r, type };

  // zh-CN no year
  if (year) {
    await sleep(50);
    r = await searchTmdb(clean, type, null, idx++);
    if (r) return { result: r, type };
  }

  //纪录片 try both
  if (type === 'movie') {
    await sleep(50);
    r = await searchTmdb(clean, 'tv', null, idx++);
    if (r) return { result: r, type: 'tv' };
  }

  // en-US
  await sleep(50);
  r = await searchTmdb(clean, type, null, idx++);
  if (r) return { result: r, type };

  return null;
}

async function main() {
  const batchSize = parseInt(process.argv[2] || '100');
  const batchNum = parseInt(process.argv[3] || '1');
  const skip = (batchNum - 1) * batchSize;

  console.log(`=== 批量匹配 #${batchNum} (${batchSize}条, 跳过前${skip}条) ===`);

  const rows = await sql`
    SELECT id, name, category, sub_type
    FROM xx_resources
    WHERE (tmdb_id IS NULL OR tmdb_id = '')
      AND status = 'active'
      AND name IS NOT NULL
      AND LENGTH(name) > 2
      AND category NOT IN ('音乐', '体育', '合集', '学习资料', '其他', '游戏', '电子书', '精品课', '文档')
    ORDER BY id
    LIMIT ${batchSize}
    OFFSET ${skip}
  `;

  if (rows.length === 0) { console.log('没有更多未匹配资源了'); return; }

  console.log(`查到 ${rows.length} 条，开始...`);
  let matched = 0, failed = 0, skipped = 0;

  for (const row of rows) {
    process.stdout.write(`[${matched+failed+skipped+1}/${rows.length}] ${row.name.slice(0,25)} → `);
    try {
      const m = await matchOne(row.name, row.category, row.sub_type);
      if (m) {
        await cacheAndUpdate(row.id, m.result, m.type);
        matched++;
        console.log(`✓ tmdb:${m.result.id} (${(m.result.title||m.result.name||'').slice(0,20)})`);
      } else {
        skipped++;
        console.log(`✗ 无匹配`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ ${e.message.slice(0,40)}`);
    }
  }

  console.log(`\n完成：匹配${matched} 失败${failed} 跳过${skipped}`);
}

main().catch(console.error);
