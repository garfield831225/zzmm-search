// 详细查 playerla + m3u8
process.env.HTTPS_PROXY = 'http://192.168.3.3:7897';
process.env.HTTP_PROXY = 'http://192.168.3.3:7897';

const url = 'https://www.xingfan.cc/xijupian/jingshengjianxiao6/1-1.html';
const resp = await fetch(url, {
  headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  signal: AbortSignal.timeout(20000),
});
const text = await resp.text();

// 找含 playerla 的 上下文 (200 字符)
const idx = text.indexOf('playerla');
console.log('playerla 出现位置:', idx);
if (idx > 0) {
  console.log('上下文 (前后 300):');
  console.log(text.slice(Math.max(0, idx - 300), idx + 500));
}

// 找所有 src / data-url
const srcMatches = [...text.matchAll(/(?:src|data-url|data-src)=["']([^"']+)["']/gi)];
console.log('\n=== 所有 src / data-url ===');
for (const m of srcMatches.slice(0, 15)) {
  console.log(' ', m[0].slice(0, 200));
}

// 找 window.player_data / var player_ / config
const cfgMatches = [...text.matchAll(/(player_?data|player_?url|player_?src|video_?url|video_?src)["']?\s*[:=]\s*["']([^"']+)["']/gi)];
console.log('\n=== 视频配置 ===');
for (const m of cfgMatches.slice(0, 10)) {
  console.log(' ', m[0].slice(0, 200));
}

// 找 .episode-link 附近 HTML
const epIdx = text.indexOf('episode-link');
if (epIdx > 0) {
  console.log('\n=== episode-link 上下文 (前后 500) ===');
  console.log(text.slice(Math.max(0, epIdx - 500), epIdx + 500));
}
