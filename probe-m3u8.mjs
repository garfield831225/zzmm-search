// 探查 playerla 内部 m3u8 怎么拿
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const url = 'https://php.playerla.com/mjplay/?id=CMjcwOTNfMG1hYw==';
const r = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xingfan.cc/' },
  signal: AbortSignal.timeout(20000),
});
const html = await r.text();
console.log('size:', html.length);

// 找 m3u8 / video URL 相关
const $ = await import('cheerio').then((m) => m.load(html));
const scripts = [];
$('script').each((_, el) => {
  const src = $(el).attr('src');
  if (src) scripts.push(src);
});
console.log('\n=== 加载的 script ===');
console.log(scripts);

// 输出关键 script src
const lookups = [
  ...html.matchAll(/https?:\/\/[^"'<>\s]*\.m3u8[^"'<>\s]*/gi),
  ...html.matchAll(/var\s+(player|video|player_)[^=]*=\s*["']([^"']+)["']/gi),
  ...html.matchAll(/api[^"']*["']([^"']+m3u8[^"']*)["']/gi),
];
console.log('\n=== 关键匹配 ===');
for (const m of lookups) {
  console.log(' ', m[0].slice(0, 200));
}

// 看 artplayer / m3u8 相关字符串
const idx = html.indexOf('m3u8');
if (idx > 0) {
  console.log('\n=== m3u8 上下文 (前 200 后 500) ===');
  console.log(html.slice(Math.max(0, idx - 200), idx + 500));
}
