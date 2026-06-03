const TMDB_KEY = '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';

async function search(name) {
  const url = `${TMDB_BASE}/search/tv?query=${encodeURIComponent(name)}&api_key=${TMDB_KEY}&language=zh-CN&page=1`;
  const r = await fetch(url);
  const d = await r.json();
  return d.results || [];
}

async function detail(id) {
  const url = `${TMDB_BASE}/tv/${id}?api_key=${TMDB_KEY}&language=zh-CN`;
  const r = await fetch(url);
  return r.json();
}

(async () => {
  const name = '神与律师事务所';
  console.log(`=== 搜索"${name}" ===`);
  const results = await search(name);
  console.log('找到', results.length, '条结果\n');
  for (const r of results.slice(0, 5)) {
    const d = await detail(r.id);
    console.log('---');
    console.log('  tmdb_id:', r.id);
    console.log('  name:', r.name);
    console.log('  original_name:', d.original_name);
    console.log('  first_air_date:', d.first_air_date);
    console.log('  last_air_date:', d.last_air_date);
    console.log('  status:', d.status);
    console.log('  number_of_seasons:', d.number_of_seasons);
    console.log('  number_of_episodes:', d.number_of_episodes);
    console.log('  origin_country:', d.origin_country);
    console.log('  vote_average:', d.vote_average);
    console.log('  overview:', (d.overview || '').slice(0, 80));
  }
})().catch(console.error);
