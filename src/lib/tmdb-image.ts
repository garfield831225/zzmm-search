// 2026-08-05: TMDB 图片 helper
//   - 统一管理图片尺寸 (Section 卡片用 w342, Banner 用 w780, 演员头像用 w45)
//   - 2026-08-05 step 2: BASE_URL 切到 image.zzmm-search.uk (CF Worker 反代, 解决 GFW + 30 天边缘缓存)
//   - 旧 image.tmdb.org 在国内慢, CF 边缘节点直拉 TMDB 给用户, 速度 <100ms
//
// 2026-10-29 优化: 传入的"完整 URL"也要规整到 CF 边缘
//   背景: xx_tmdb_cache.poster_path 有 22238 条存的是完整 URL (https://image.tmdb.org/t/p/w500/xxx)
//   原来 `if (path.startsWith('http')) return path` 会原样返回 → 用户直连 TMDB, 实测 12 秒一张图
//   现在统一改写成 image.zzmm-search.uk + 按需求尺寸重套 (实测 w342: 290ms vs 12197ms, 42 倍)
//   2026-10-29: 全站 src/ 下 32 处 image.tmdb.org 硬编码也一并换掉了

const BASE_URL = 'https://image.zzmm-search.uk/t/p';

// TMDB 官方尺寸 (官方文档): https://developers.themoviedb.org/3/getting-started/images
// poster: w92, w154, w185, w342, w500, w780, original
// backdrop: w300, w780, w1280, original
// profile: w45, w185, h632, original
const POSTER = {
  thumb: 'w154',   // 小缩略图
  card: 'w342',    // Section 卡片 (首页/详情页)
  large: 'w500',   // 详情页大图
  full: 'w780',    // 海报原图
};
const BACKDROP = {
  small: 'w300',
  banner: 'w780',  // 之前 w1280 太大, 改 w780
  full: 'w1280',
};
const PROFILE = {
  tiny: 'w45',     // 演员头像小 (替代 w185)
  card: 'w185',
  large: 'h632',
};

// 匹配 TMDB 图片路径 (两种域名都认), 取出文件名
const TMDB_IMG_RE = /^https?:\/\/(?:image\.tmdb\.org|image\.zzmm-search\.uk)\/t\/p\/[a-z0-9_]+\/(.+)$/i;

/**
 * 把任意 TMDB 图片路径规整成 CF 边缘反代 + 指定尺寸
 * @param path 相对路径 (/xxx.jpg) / TMDB 完整 URL / 其它 URL
 * @param sizeMap 尺寸表
 * @param size 尺寸键
 */
function buildImageUrl(path: string | null | undefined, sizeMap: Record<string, string>, size: string): string {
  if (!path) return '';
  const raw = String(path).trim();
  if (!raw) return '';

  const m = raw.match(TMDB_IMG_RE);
  if (m) {
    // TMDB 图片 (相对或完整 URL) → CF 边缘 + 重新套尺寸 (w500 的海报按 card 用时降成 w342, 更快更小)
    return `${BASE_URL}/${sizeMap[size] || sizeMap.card}/${m[1]}`;
  }
  if (raw.startsWith('/')) {
    // 相对路径
    return `${BASE_URL}/${sizeMap[size] || sizeMap.card}${raw}`;
  }
  // 其它域名 (非 TMDB) → 原样返回, 不乱改
  return raw;
}

export function tmdbPoster(path: string | null | undefined, size: keyof typeof POSTER = 'card'): string {
  return buildImageUrl(path, POSTER, size);
}

export function tmdbBackdrop(path: string | null | undefined, size: keyof typeof BACKDROP = 'banner'): string {
  return buildImageUrl(path, BACKDROP, size);
}

export function tmdbProfile(path: string | null | undefined, size: keyof typeof PROFILE = 'tiny'): string {
  return buildImageUrl(path, PROFILE, size);
}

// 直接给完整 URL 换域名 + 套尺寸 (给 API 侧用, 避免各路由各写一套)
export function tmdbImageUrl(path: string | null | undefined, size: string = 'w500'): string {
  if (!path) return '';
  const raw = String(path).trim();
  const m = raw.match(TMDB_IMG_RE);
  if (m) return `${BASE_URL}/${size}/${m[1]}`;
  if (raw.startsWith('/')) return `${BASE_URL}/${size}${raw}`;
  return raw;
}

// Fallback 占位图
// 2026-10-29: 原来指向 TMDB 的 7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg —— **这张图在 TMDB 官方上就是 404**
//   (实测 image.tmdb.org / image.zzmm-search.uk 各尺寸全 404)
//   → 所有没海报的卡片一直显示裂图, 还会触发 onError 死循环反复重试
//   改用本地静态 SVG: 零外部依赖、永远可用、CF 边缘秒开
export const TMDB_FALLBACK = '/poster-placeholder.svg';
