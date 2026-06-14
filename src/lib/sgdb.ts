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
    .replace(/\/附.*$/, '') // "/附历代合集" 这种
    .trim();
  let cleaned = cleanName;
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/').map(s => s.trim()).filter(Boolean);
    // 优先选包含英文的 (取最长)
    const ascii = parts.filter(p => /[a-zA-Z]/.test(p));
    if (ascii.length > 0) {
      cleaned = ascii.sort((a, b) => b.length - a.length)[0];
    } else {
      // 全中文, 取最短的
      cleaned = parts.sort((a, b) => a.length - b.length)[0];
    }
  } else {
    // 无 /: 去 "中文名：xxx" 后面的中文副标题
    // eg "刺客信条编年史：俄罗斯" → "刺客信条编年史"
    // 但 "使命召唤7：黑色行动" → "使命召唤7" 错了, 所以仅当 : 之前是中文且 之后无英文时
    if (cleaned.includes('：')) {
      const [before, after] = cleaned.split('：', 2);
      if (!/[a-zA-Z]/.test(after) && /[\u4e00-\u9fa5]/.test(after)) {
        cleaned = before.trim();
      }
    }
  }
  if (!cleaned) return null;

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
