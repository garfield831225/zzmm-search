// 抓 xingfan 详情页找真实视频 URL
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const url = 'https://www.xingfan.cc/xijupian/jingshengjianxiao6/1-1.html';
const resp = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  signal: AbortSignal.timeout(20000),
});
const text = await resp.text();
console.log('size:', text.length);

// 找 iframe / playerla / m3u8
const matches = [
  ...text.matchAll(/iframe[^>]*src=["']([^"']+)["']/gi),
  ...text.matchAll(/playerla[^"'<>\s]*/gi),
  ...text.matchAll(/https?:\/\/[^"'<>\s]*\.m3u8[^"'<>\s]*/gi),
  ...text.matchAll(/https?:\/\/[^"'<>\s]*\.mp4[^"'<>\s]*/gi),
];
console.log('\n=== 匹配 ===');
for (const m of matches) {
  console.log(' ', m[0].slice(0, 200));
}

// 看 playerla 完整 URL
const playerlaMatch = text.match(/https?:\/\/[^"'<>\s]*playerla[^"'<>\s]*/);
if (playerlaMatch) {
  console.log('\n=== playerla URL ===');
  console.log(' ', playerlaMatch[0]);
}

// 找 .episode-link 链接列表 (从之前脚本看的)
const $ = await import('cheerio').then((m) => m.load(text));
const epLinks = [];
$('a.episode-link').each((_, el) => {
  epLinks.push({ href: $(el).attr('href'), text: $(el).text().trim() });
});
console.log('\n=== episode links 数量:', epLinks.length, '===');
console.log(epLinks.slice(0, 3));
