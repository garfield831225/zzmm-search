// src/lib/rawg.ts — 通过 NAS 反代抓 rawg.io
// rawg.io 拦 Vercel serverless IP (CF 防护), 必须走家里 IP
// NAS 上 rawg-proxy 容器 (3001) + Cloudflare Tunnel 暴露为 rawg.zzmmemby.cn

const NAS_RAWG_URL = process.env.NAS_RAWG_URL || 'https://rawg.zzmmemby.cn';
const NAS_RAWG_TOKEN = process.env.NAS_RAWG_TOKEN || '';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface RawgGameResult {
  slug: string;        // /games/the-legend-of-zelda-breath-of-the-wild
  name: string;        // 游戏名
  cover: string | null; // cover URL
  year: number | null;
  rating: number | null;
}

export class RawgProxyError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

/** 通过 NAS 反代抓 rawg 网页 HTML */
async function fetchRawgHtml(path: string): Promise<string> {
  if (!NAS_RAWG_URL || !NAS_RAWG_TOKEN) {
    throw new RawgProxyError(503, 'NAS_RAWG_URL/NAS_RAWG_TOKEN 未配置');
  }
  const r = await fetch(NAS_RAWG_URL + path, {
    headers: {
      'X-Proxy-Token': NAS_RAWG_TOKEN,
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) {
    throw new RawgProxyError(r.status, `NAS 反代返回 ${r.status}`);
  }
  return r.text();
}

/** 搜索 rawg 游戏, 返回第一条结果 */
export async function searchRawg(name: string): Promise<RawgGameResult | null> {
  // 清理游戏名: 去除 [PSN][中文] 标签, / 别名, 文件后缀
  const cleanName = name
    .replace(/\[.*?\]/g, '')  // [PSN][亚版][中文]
    .replace(/\.7z|\.zip|\.rar|\.iso/g, '')
    .replace(/\/.*$/, '')      // / 英文别名
    .trim();
  if (!cleanName) return null;

  const html = await fetchRawgHtml('/games?query=' + encodeURIComponent(cleanName) + '&page_size=1');

  // 1. 取第一条游戏链接
  const linkMatch = html.match(/href="(\/games\/[a-z0-9][a-z0-9\-]*[a-z0-9])"/i);
  if (!linkMatch) return null;
  const slug = linkMatch[1].replace('/games/', '');

  // 2. 从同一搜索页拿 og:image (rawg 搜索页直接有图, 不用跳详情)
  const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const cover = ogMatch?.[1] || null;

  // 3. 取游戏名 (h2 / a tag)
  const nameMatch = html.match(new RegExp(`href="/games/${slug}"[^>]*>([^<]+)<`, 'i'));
  const displayName = nameMatch?.[1]?.trim() || cleanName;

  return { slug, name: displayName, cover, year: null, rating: null };
}
