// 探查 xingfan 搜索结果完整内容
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

async function test() {
  const url = 'https://www.xingfan.cc/index.php?s=home-search.html&wd=' + encodeURIComponent('奥德赛');
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await resp.text();
  console.log('size:', text.length);
  // 找 "奥德赛" 出现位置
  const idx = text.indexOf('奥德赛');
  while (idx !== -1) {
    console.log(`[idx ${idx}] context: ...${text.slice(Math.max(0, idx - 80), idx + 200)}...`);
    const next = text.indexOf('奥德赛', idx + 1);
    if (next === idx) break;
    if (next === -1) break;
    // 只看前 3 个
    if (next - idx < 5) break;
  }
  // 输出所有 a 标签 + 文本
  const $ = await import('cheerio').then((m) => m.load(text));
  const all = $('a').map((_, el) => ({
    href: $(el).attr('href') || '',
    text: $(el).text().trim().replace(/\s+/g, ' ').slice(0, 100),
  })).get();
  console.log('\n=== ALL LINKS ===');
  all.forEach((l) => console.log(`  ${l.href} | ${l.text}`));
}
test().catch(console.error);
