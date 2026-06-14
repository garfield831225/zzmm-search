// src/lib/igdb.ts — IGDB (Twitch) 游戏匹配
// IGDB 不拦 Cloudflare/Vercel, 4 req/s, 覆盖比 rawg 全, 封面稳定
// 鉴权: Client Credentials (client_id + client_secret, 无需 2FA 之外的额外操作)

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID || '';
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || '';
const IGDB_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const IGDB_API_URL = 'https://api.igdb.com/v4';

// 内存缓存 token (2 个月有效, 用 .expires_in 提前 5 分钟刷新)
let tokenCache: { token: string; expiresAt: number } | null = null;

export class IgdbError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function getAccessToken(): Promise<string> {
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    throw new IgdbError(503, 'IGDB_CLIENT_ID/IGDB_CLIENT_SECRET 未配置');
  }
  // token 还有效?
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
    return tokenCache.token;
  }
  // 拿新 token
  const r = await fetch(IGDB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: IGDB_CLIENT_ID,
      client_secret: IGDB_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new IgdbError(r.status, `IGDB 拿 token 失败: ${t.slice(0, 200)}`);
  }
  const d = await r.json();
  tokenCache = {
    token: d.access_token,
    expiresAt: Date.now() + d.expires_in * 1000,
  };
  return d.access_token;
}

export interface IgdbGame {
  id: number;
  name: string;
  cover: string | null;
  summary: string | null;
  releaseDate: string | null;
  rating: number | null;
}

/** 搜 IGDB, 返回第一条匹配 */
export async function searchIgdb(name: string): Promise<IgdbGame | null> {
  const cleanName = name
    .replace(/\[.*?\]/g, '')  // [PSN][亚版][中文]
    .replace(/\.7z|\.zip|\.rar|\.iso/g, '')
    .replace(/\/.*$/, '')      // / 英文别名
    .trim();
  if (!cleanName) return null;

  const token = await getAccessToken();

  // 搜游戏
  const searchR = await fetch(IGDB_API_URL + '/games', {
    method: 'POST',
    headers: {
      'Client-ID': IGDB_CLIENT_ID,
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'text/plain',
    },
    body: `search "${cleanName.replace(/"/g, '\\"')}"; fields id,name,cover.url,cover.image_id,first_release_date,total_rating,summary; limit 1;`,
    signal: AbortSignal.timeout(15000),
  });
  if (!searchR.ok) {
    throw new IgdbError(searchR.status, `IGDB search 失败: ${(await searchR.text()).slice(0, 200)}`);
  }
  const list = await searchR.json();
  if (!Array.isArray(list) || list.length === 0) return null;

  const g = list[0];
  let cover: string | null = null;
  if (g.cover?.image_id) {
    // IGDB 封面: image_id -> https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg
    cover = `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`;
  } else if (g.cover?.url) {
    cover = g.cover.url.replace('t_thumb', 't_cover_big');
  }
  return {
    id: g.id,
    name: g.name,
    cover,
    summary: g.summary || null,
    releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : null,
    rating: g.total_rating || null,
  };
}
