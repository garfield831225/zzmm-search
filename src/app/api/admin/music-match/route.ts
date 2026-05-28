import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

// 从文件名提取专辑名（去掉噪声）
function extractAlbum(name: string): string {
  return name
    .replace(/\[([^\]]+)\]/g, ' $1 ')
    .replace(/\(([^)]+)\)/g, ' $1 ')
    .replace(/【([^】]+)】/g, ' $1 ')
    .replace(/FLAC|WAV|APE|ALAC|DSD|Hi-Res|24bit|16bit|48kHz|96kHz|192kHz|SACD|DV|BD|MKV|MP4|ISO|演唱会|录音室|LIVE版/g, ' ')
    .replace(/20\d{2}[-.]?\d{0,2}/g, ' ')
    .replace(/\.(mkv|mp4|flac|wav|ape|iso)$/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// MusicBrainz 搜索专辑
async function searchMusicBrainz(album: string): Promise<{ mbid: string; artist: string; album: string; coverUrl: string } | null> {
  if (!album || album.length < 2) return null;
  try {
    const url = `https://musicbrainz.org/ws/2/release/?query=release:${encodeURIComponent(album)}&fmt=json&limit=3`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'zzmm-search/1.0 (zzmm-search@zzmm.cc)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const releases: any[] = data.releases || [];
    if (!releases.length) return null;

    // 取第一个有封面的
    for (const r of releases) {
      if (!r.id) continue;
      // Cover Art Archive: 先试试直接封面
      const coverRes = await fetch(`https://coverartarchive.org/release/${r.id}/front-250`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'zzmm-search/1.0' },
      });
      if (coverRes.ok) {
        const artistName = r['artist-credit']?.[0]?.name || r.artist?.name || '';
        return {
          mbid: r.id,
          artist: artistName,
          album: r.title || album,
          coverUrl: coverRes.url,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// 睡眠（rate limit: 1 req/sec）
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.JWT_SECRET}`) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL || '');

  // 找出所有未匹配的 music 资源
  const musicResources = await sql`
    SELECT r.id, r.name
    FROM xx_resources r
    LEFT JOIN xx_music_cache mc ON mc.resource_id = r.id
    WHERE r.category = '音乐'
      AND r.status = 'active'
      AND mc.resource_id IS NULL
    LIMIT 200
  `;

  if (!musicResources.length) {
    return NextResponse.json({ success: true, message: '没有需要匹配的音乐资源', matched: 0 });
  }

  let matched = 0;
  for (const resource of musicResources) {
    const albumName = extractAlbum(resource.name);
    if (!albumName) continue;

    const result = await searchMusicBrainz(albumName);
    if (result) {
      await sql`
        INSERT INTO xx_music_cache (resource_id, mb_release_id, artist, album, cover_url, cached_at)
        VALUES (${resource.id}, ${result.mbid}, ${result.artist}, ${result.album}, ${result.coverUrl}, NOW())
        ON CONFLICT (resource_id) DO UPDATE SET
          mb_release_id = EXCLUDED.mb_release_id,
          artist = EXCLUDED.artist,
          album = EXCLUDED.album,
          cover_url = EXCLUDED.cover_url,
          cached_at = NOW()
      `;
      matched++;
    }
    // Rate limit: 1 req/sec
    await sleep(1100);
  }

  return NextResponse.json({
    success: true,
    processed: musicResources.length,
    matched,
    message: `处理 ${musicResources.length} 条音乐资源，成功匹配 ${matched} 张封面`,
  });
}
