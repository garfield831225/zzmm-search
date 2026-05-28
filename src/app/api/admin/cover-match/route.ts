import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// 匹配接口：手动触发，为指定分类的资源匹配封面元数据
// POST /api/admin/cover-match
// Body: { "categories": ["体育", "游戏", "电子书"], "limit": 50 }

const JWT_SECRET = process.env.JWT_SECRET || 'caoliangweizhendeshuang';

// 限速：每条资源最多等待 1 秒（避免压垮第三方 API）
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

// ============ MusicBrainz ============
async function matchMusic(name: string): Promise<{ cover_url: string; artist: string; album: string } | null> {
  try {
    const q = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    // 去掉后缀如 2024/Flac/24Bit 等
    const cleanQ = q.replace(/\s*(FLAC|WAV|ALAC|DSD|Hi-Res|24bit|16bit|母带|无损)/gi, '').trim();
    const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(cleanQ)}&fmt=json&limit=3`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'zzmm-search/1.0 (zzmm-search@zzmm.cc)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const release = data.releases?.[0];
    if (!release) return null;
    // 用 coverartarchive 拿封面
    const mbid = release.id;
    const coverRes = await fetch(`https://coverartarchive.org/release/${mbid}/front-250`, { method: 'HEAD' });
    if (!coverRes.ok) return null;
    return {
      cover_url: `https://coverartarchive.org/release/${mbid}/front-250`,
      artist: release['artist-credit']?.[0]?.name || '',
      album: release.title || cleanQ,
    };
  } catch { return null; }
}

// ============ TheSportsDB ============
async function matchSports(name: string): Promise<{ cover_url: string; sport_type: string } | null> {
  try {
    const url = `https://www.thesportsdb.com/api/v1/json/3/search.php?t=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const team = data.teams?.[0];
    if (!team) return null;
    // badge 是球队 logo，strLeague 是联赛 logo
    const cover_url = team.strBadge || team.strLogo || team.strPoster || '';
    if (!cover_url) return null;
    return {
      cover_url,
      sport_type: team.strSport || 'Team',
    };
  } catch { return null; }
}

// ============ Steam Store API ============
async function matchGame(name: string): Promise<{ cover_url: string; game_name: string } | null> {
  try {
    const q = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    const cleanQ = q.replace(/\s*(游戏|PC版|steam版|汉化|免安装|整合版)/gi, '').trim();
    const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(cleanQ)}&cc=CN&l=zhCN&v=4`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return null;
    const cover_url = item.capsule_image || item.small_capsule_image || '';
    if (!cover_url) return null;
    return {
      cover_url,
      game_name: item.name || cleanQ,
    };
  } catch { return null; }
}

// ============ Open Library ============
async function matchEbook(name: string): Promise<{ cover_url: string; author: string; title: string } | null> {
  try {
    const q = name.replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    const cleanQ = q.replace(/\s*(PDF|EPUB|MOBI|TXT|azw3|电子书|扫描版)/gi, '').trim();
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(cleanQ)}&limit=3`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const doc = data.docs?.[0];
    if (!doc) return null;
    const cover_url = doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : doc.isbn?.[0]
      ? `https://covers.openlibrary.org/b/isbn/${doc.isbn[0]}-M.jpg`
      : '';
    if (!cover_url) return null;
    return {
      cover_url,
      author: doc.author_name?.[0] || '',
      title: doc.title || cleanQ,
    };
  } catch { return null; }
}

// ============ 主路由 ============
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (body.key !== JWT_SECRET) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const categories = body.categories || ['音乐', '体育', '游戏', '电子书'];
  const limit = Math.min(parseInt(body.limit) || 50, 100);

  const sql = neon(process.env.DATABASE_URL || '');

  // 获取未匹配的非影视资源
  const rows = await sql`
    SELECT r.id, r.name, r.category, r.source
    FROM xx_resources r
    WHERE r.category IN (${categories})
      AND r.status = 'active'
    ORDER BY r.id
    LIMIT ${limit}
  ` as any[];

  const results: { matched: number; skipped: number; details: string[] } = {
    matched: 0, skipped: 0, details: [],
  };

  for (const row of rows) {
    const { id, name, category } = row;
    try {
      let meta: any = null;
      if (category === '音乐') meta = await matchMusic(name);
      else if (category === '体育') meta = await matchSports(name);
      else if (['游戏', '电子游戏'].includes(category)) meta = await matchGame(name);
      else if (['电子书', '学习资料', '文档'].includes(category)) meta = await matchEbook(name);

      if (meta?.cover_url) {
        // 存入 xx_cover_cache 表（或直接更新 xx_resources）
        await sql`
          INSERT INTO xx_cover_cache (resource_id, cover_url, source, extra_data, cached_at)
          VALUES (${id}, ${meta.cover_url}, ${category}, ${JSON.stringify(meta)}, NOW())
          ON CONFLICT (resource_id) DO UPDATE SET
            cover_url = EXCLUDED.cover_url,
            extra_data = EXCLUDED.extra_data,
            cached_at = NOW()
        `.catch(() => {
          // 表不存在，先创建
          return sql`CREATE TABLE IF NOT EXISTS xx_cover_cache (
            resource_id INTEGER PRIMARY KEY,
            cover_url TEXT,
            source TEXT,
            extra_data TEXT,
            cached_at TIMESTAMP DEFAULT NOW()
          )`.catch(() => {});
        });
        results.matched++;
        results.details.push(`${category} ✓ ${name.slice(0, 20)}`);
      } else {
        results.skipped++;
      }
    } catch {
      results.skipped++;
    }

    await delay(800); // 限速 800ms，避免被限
  }

  return NextResponse.json({
    success: true,
    processed: rows.length,
    matched: results.matched,
    skipped: results.skipped,
    details: results.details.slice(0, 20),
  });
}