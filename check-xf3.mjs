// 查 /juqingpian/duoge/1-1.html 为啥没 playerla
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const r = await fetch('https://www.xingfan.cc/juqingpian/duoge/1-1.html', {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  signal: AbortSignal.timeout(15000),
});
const text = await r.text();
console.log('status:', r.status, 'size:', text.length);
const m = text.match(/var\s+zanpiancms_player\s*=\s*(\{[^;]+\})/);
console.log('player match:', m ? m[1] : 'NOT FOUND');
// 找 episode-link
const $ = await import('cheerio').then((m) => m.load(text));
const eps = [];
$('a.episode-link').each((_, el) => {
  eps.push({ href: $(el).attr('href'), text: $(el).text().trim() });
});
console.log('episodes:', eps);
