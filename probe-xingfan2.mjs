// 探测 xingfan.cc 真实搜索 - 用 env HTTPS_PROXY
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

async function test(url, label) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await resp.text();
    const $ = await import('cheerio').then((m) => m.load(text));
    const titleHits = $('a').map((_, el) => $(el).text().trim()).get().filter((t) => t.includes('奥德赛') || t.includes('Odyssey') || t.includes('odyssey'));
    const hasSearchHint = text.includes('搜索') || text.includes('search') || text.includes('wd=');
    console.log(`[${label}] code=${resp.status} size=${text.length} searchHint=${hasSearchHint} hits=${titleHits.length}`);
    if (titleHits.length > 0) {
      console.log('   hits:', titleHits.slice(0, 3));
    }
    // 找详情页 URL 模式 (/[a-z]+/[a-z0-9]+/)
    const detailLinks = $('a').map((_, el) => $(el).attr('href') || '').get().filter((h) => /^\/[a-z]+\/[a-z0-9-]+\/?$/.test(h));
    console.log(`   detail-like links: ${detailLinks.length}, sample: ${JSON.stringify(detailLinks.slice(0, 8))}`);
  } catch (e) {
    console.log(`[${label}] ERR: ${e.message.slice(0, 100)}`);
  }
}

await test('https://www.xingfan.cc/?wd=奥德赛', 'A:?wd=');
await test('https://www.xingfan.cc/?wd=Odyssey', 'B:?wd=en');
await test('https://www.xingfan.cc/search.html?wd=奥德赛', 'C:search.html?wd=');
await test('https://www.xingfan.cc/index.php?s=home-search.html&wd=奥德赛', 'D:index.php');
await test('https://www.xingfan.cc/index.php?m=search&wd=奥德赛', 'E:index.php?m=search');
await test('https://www.xingfan.cc/search/奥德赛', 'F:search/zh');
await test('https://www.xingfan.cc/so/奥德赛', 'G:so/zh');
await test('https://www.xingfan.cc/', 'H:home');
