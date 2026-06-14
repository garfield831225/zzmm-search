// src/lib/sgdb.ts — Steam Grid DB 游戏封面
// 不拦 IP, 不需要 OAuth, 简单 API key 鉴权
// 5 req/s 免费, 适合批量匹配

const SGDB_API_KEY = process.env.SGDB_API_KEY || '';
const SGDB_API_URL = 'https://www.steamgriddb.com/api/v2';

export class SgdbError extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

const HEADERS: Record<string, string> = {
  'Authorization': 'Bearer ' + SGDB_API_KEY,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export interface SgdbGame {
  id: number;
  name: string;
  cover: string | null;     // 460x215
  coverVertical: string | null;  // 600x900 (海报)
  releaseYear: number | null;
}

/** 通过名字搜游戏, 返回最佳匹配 */
export async function searchSgdb(name: string): Promise<SgdbGame | null> {
  if (!SGDB_API_KEY) {
    throw new SgdbError(503, 'SGDB_API_KEY 未配置');
  }
  const cleanName = name
    .replace(/\[.*?\]/g, '')
    .replace(/\.7z|\.zip|\.rar|\.iso/g, '')
    .replace(/\/.*$/, '')
    .trim();
  if (!cleanName) return null;

  // SGDB search endpoint (v2): GET /search/autocomplete/{term}
  const r = await fetch(`${SGDB_API_URL}/search/autocomplete/${encodeURIComponent(cleanName)}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) {
    throw new SgdbError(r.status, `SGDB search 失败: ${(await r.text()).slice(0, 200)}`);
  }
  const list = await r.json();
  if (!Array.isArray(list?.data) || list.data.length === 0) return null;

  const g = list.data[0]; // {id, name, release_year}
  const gameId = g.id;

  // 拿 grid (背景)
  let cover: string | null = null;
  let coverVertical: string | null = null;
  try {
    const gR = await fetch(`${SGDB_API_URL}/grids/game/${gameId}?dimensions=460x215,600x900&types=static&mature=false&limit=2`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if (gR.ok) {
      const gData = await gR.json();
      const grids: any[] = gData.data || [];
      // 优先 460x215 (横向, 大部分游戏都有)
      const horiz = grids.find((g: any) => g.width === 460 && g.height === 215);
      const vert = grids.find((g: any) => g.width === 600 && g.height === 900);
      cover = horiz?.url || null;
      coverVertical = vert?.url || horiz?.url || null;
    }
  } catch {}

  return {
    id: gameId,
    name: g.name,
    cover,
    coverVertical,
    releaseYear: g.release_year || null,
  };
}
