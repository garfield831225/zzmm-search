// 探测 xingfan.cc 真实搜索
import { HttpsProxyAgent } from 'https-proxy-agent';

const PROXY = 'http://192.168.3.3:7897';

async function test(url, label) {
  const agent = new HttpsProxyAgent(PROXY);
  try {
    const resp = await fetch(url, {
      agent,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await resp.text();
    const $ = await import('cheerio').then((m) => m.load(text));
    // 看是不是搜索结果页 (有搜索关键词命中)
    const titleHits = $('a').map((_, el) => $(el).text().trim()).get().filter((t) => t.includes('奥德赛') || t.includes('Odyssey'));
    const hasSearchHint = text.includes('搜索') || text.includes('search') || text.includes('wd=');
    console.log(`[${label}] code=${resp.status} size=${text.length} searchHint=${hasSearchHint} odysseyHits=${titleHits.length}`);
    if (titleHits.length > 0) {
      console.log('   first 3 hits:', titleHits.slice(0, 3));
    }
    // 输出前 5 个 a 标签文本
    const sample = $('a').map((_, el) => $(el).text().trim().slice(0, 40)).get().filter((t) => t.length > 0).slice(0, 10);
    console.log('   sample links:', JSON.stringify(sample));
  } catch (e) {
    console.log(`[${label}] ERR: ${e.message}`);
  }
}

await test('https://www.xingfan.cc/?wd=奥德赛', 'A:?wd=');
await test('https://www.xingfan.cc/?wd=Odyssey', 'B:?wd=en');
await test('https://www.xingfan.cc/search.html?wd=奥德赛', 'C:search.html?wd=');
await test('https://www.xingfan.cc/search/wd/奥德赛', 'D:search/wd/');
await test('https://www.xingfan.cc/index.php?s=home-search.html&wd=奥德赛', 'E:index.php');
await test('https://www.xingfan.cc/', 'F:home');
