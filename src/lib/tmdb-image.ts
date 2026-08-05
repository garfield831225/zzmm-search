// 2026-08-05: TMDB 图片 helper
//   - 统一管理图片尺寸 (Section 卡片用 w342, Banner 用 w780, 演员头像用 w45)
//   - 默认走 image.tmdb.org
//   - step 2 配完 CF Worker 后, 把 BASE_URL 改成 image.zzmm-search.uk 即可换反代

const BASE_URL = process.env.NEXT_PUBLIC_TMDB_IMG_BASE || 'https://image.tmdb.org/t/p';

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

export function tmdbPoster(path: string | null | undefined, size: keyof typeof POSTER = 'card'): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BASE_URL}/${POSTER[size]}${path}`;
}

export function tmdbBackdrop(path: string | null | undefined, size: keyof typeof BACKDROP = 'banner'): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BASE_URL}/${BACKDROP[size]}${path}`;
}

export function tmdbProfile(path: string | null | undefined, size: keyof typeof PROFILE = 'tiny'): string {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${BASE_URL}/${PROFILE[size]}${path}`;
}

// Fallback 占位图 (TMDB 自带兜底海报)
export const TMDB_FALLBACK = `${BASE_URL}/w342/7bUqJAuI5LFiJ6xMcLQ2E3YL8w1a.jpg`;
