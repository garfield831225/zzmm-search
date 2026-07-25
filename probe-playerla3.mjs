// 抓 juhe.js + 试 playerla API
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

// 1. 抓 juhe.js
const juheUrl = 'https://www.xingfan.cc/player/juhe.js';
const r1 = await fetch(juheUrl, {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xingfan.cc/xijupian/jingshengjianxiao6/1-1.html' },
  signal: AbortSignal.timeout(15000),
});
const juheJs = await r1.text();
console.log('=== juhe.js (前 1500 字符) ===');
console.log(juheJs.slice(0, 1500));

// 2. 试 playerla API
console.log('\n=== 调 playerla API ===');
const apiUrl = 'https://php.playerla.com/mjplay/?id=CMjcwOTNfMG1hYw==';
const r2 = await fetch(apiUrl, {
  headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.xingfan.cc/' },
  signal: AbortSignal.timeout(15000),
});
console.log('status:', r2.status);
const apiText = await r2.text();
console.log('size:', apiText.length);
console.log('前 500 字符:');
console.log(apiText.slice(0, 500));
