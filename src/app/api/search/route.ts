export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

const TMDB_KEY = process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';

const SOURCE_KEY_MAP: Record<string, string> = {
  '115网盘': '115', '百度网盘': 'baidu', '阿里云盘': 'aliyun',
  '夸克网盘': 'quark', '123网盘': '123', '天翼云盘': 'tianyi',
  '磁力链接': 'magnet', 'ed2k链接': 'ed2k', '迅雷链接': 'thunder',
};
const SOURCE_DISPLAY_MAP: Record<string, string> = {
  '115': '115网盘', 'baidu': '百度网盘', 'quark': '夸克网盘',
  'aliyun': '阿里云盘', '123': '123网盘', 'tianyi': '天翼云盘',
  'magnet': '磁力链接', 'ed2k': 'ed2k链接', 'thunder': '迅雷链接',
};
const CATEGORIES = ['全部', '连载', '电影', '剧集', '动漫', '少儿频道', '综艺', '演唱会', '纪录片', '原盘', 'REMUX', '系列电影'];
const NONFILM_CATEGORIES = ['全部', '音乐', '体育', '游戏', '电子书', '精品课', '文档'];
const NONFILM_CATS = ['音乐', '体育', '游戏', '电子书', '精品课', '文档'];

const REGION_CODES: Record<string, string[]> = {
  '大陆': ['CN'],
  '欧美': ['US', 'GB', 'FR', 'DE', 'IT', 'ES', 'CA', 'AU', 'NZ'],
  '日韩': ['JP', 'KR'],
  '港澳台': ['HK', 'TW', 'MO'],
};

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

export async function GET(request: NextRequest) {
  try {
    const sql = neon(process.env.DATABASE_URL || '');
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const category = searchParams.get('category') || '全部';
    const source = searchParams.get('source') || '全部';
    const region = searchParams.get('region') || '全部';
    const year = searchParams.get('year') || '全部';
    const sort = searchParams.get('sort') || 'release_date';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(150, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const zone = searchParams.get('zone') || 'film';

    // ─── Build WHERE conditions ──────────────────────────────────────────────
    const conditions: string[] = [`r.status = 'active'`];
    const params: any[] = [];
    let idx = 1;

    // Zone/category filter
    if (category === '全部' && zone === 'film') {
      for (const cat of NONFILM_CATS) {
        conditions.push(`r.category != $${idx++}`);
        params.push(cat);
      }
    }
    if (category === '全部' && zone === 'nonfilm') {
      conditions.push(`r.category = ANY($${idx++})`);
      params.push(NONFILM_CATS);
    }
    if (category !== '全部') {
      conditions.push(`r.category = $${idx++}`);
      params.push(category);
    }
    if (source !== '全部') {
      const dbSource = SOURCE_KEY_MAP[source] || source;
      conditions.push(`r.source = $${idx++}`);
      params.push(dbSource);
    }
    if (year !== '全部' && zone === 'film') {
      if (['2026','2025','2024','2023','2022','2021','2020'].includes(year)) {
        conditions.push(`(c.release_date LIKE $${idx} OR c.release_date LIKE $${idx} || '%')`);
        params.push(`${year}-%`);
        idx++;
      } else if (year === '2010-2019') {
        conditions.push(`(c.release_date >= '2010-01-01' AND c.release_date <= '2019-12-31')`);
      } else if (year === '2000-2009') {
        conditions.push(`(c.release_date >= '2000-01-01' AND c.release_date <= '2009-12-31')`);
      }
    }
    if (q.trim()) {
      conditions.push(`(r.name ILIKE $${idx} OR r.category ILIKE $${idx})`);
      params.push(`%${q.trim()}%`);
      idx++;
    }

    const dbWhere = conditions.join(' AND ');
    const offset = (page - 1) * pageSize;
    const totalParams = [...params];

    // ─── Count total ──────────────────────────────────────────────────────────
    const countRows = await sql(`SELECT COUNT(*) as cnt FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id WHERE ${dbWhere}`, totalParams) as any[];
    const total = parseInt(countRows?.[0]?.cnt || '0');

    // ─── Fetch page ───────────────────────────────────────────────────────────
    const orderBy = sort === 'added_time'
      ? 'has_tmdb DESC, r.created_at DESC'
      : 'has_tmdb DESC, sort_date DESC NULLS LAST';

    const dbParams = [...params, pageSize, offset];
    const dbRows = await sql(
      `SELECT r.id, r.name, r.link, r.link_code, r.source, r.category, r.size, r.type, r.tags, r.tmdb_id, r.view_count, r.created_at,
              COALESCE(c.release_date, r.created_at::text) as sort_date,
              CASE WHEN r.tmdb_id IS NOT NULL AND r.tmdb_id != '' AND length(r.tmdb_id) <= 10 AND trim(r.tmdb_id) ~ '^[0-9]+$' AND (trim(r.tmdb_id)::int) > 10000 THEN 1 ELSE 0 END as has_tmdb
       FROM xx_resources r LEFT JOIN xx_tmdb_cache c ON r.tmdb_id = c.tmdb_id
       WHERE ${dbWhere}
       ORDER BY ${orderBy}, r.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      dbParams
    ) as any[];

    // ─── Batch fetch TMDB cache ───────────────────────────────────────────────
    const allIds = dbRows.map(r => r.id).filter(Boolean);
    const allTmdbIds: string[] = [];
    const seen = new Set<string>();
    dbRows.forEach(r => {
      if (r.tmdb_id && !seen.has(r.tmdb_id)) { seen.add(r.tmdb_id); allTmdbIds.push(r.tmdb_id); }
    });

    let tmdbMap = new Map<string, any>();
    if (allTmdbIds.length > 0) {
      const placeholders = allTmdbIds.map((_, i) => `$${i + 1}`).join(',');
      const tmdbRows = await sql(`SELECT * FROM xx_tmdb_cache WHERE tmdb_id IN (${placeholders})`, allTmdbIds);
      tmdbMap = new Map((tmdbRows || []).map((info: any) => [info?.tmdb_id, info]));
    }

    // ─── Batch fetch music/cover cache ──────────────────────────────────────
    let musicCoverMap = new Map<number, any>();
    let coverCacheMap = new Map<number, any>();
    if (allIds.length > 0) {
      const idPlaceholders = allIds.map((_, i) => `$${i + 1}`).join(',');
      try {
        const musicRows = await sql(`SELECT resource_id, artist, album, cover_url FROM xx_music_cache WHERE resource_id IN (${idPlaceholders})`, allIds);
        musicCoverMap = new Map((musicRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { musicCoverMap = new Map(); }
      try {
        const coverRows = await sql(`SELECT resource_id, cover_url, source, extra_data FROM xx_cover_cache WHERE resource_id IN (${idPlaceholders})`, allIds);
        coverCacheMap = new Map((coverRows || []).map((r: any) => [r?.resource_id, r]));
      } catch { coverCacheMap = new Map(); }
    }

    // ─── Map results ──────────────────────────────────────────────────────────
    const items = dbRows.map((item: any) => ({
      id: item.id,
      name: item.name,
      link: item.link || '',
      linkCode: item.link_code || '',
      source: SOURCE_DISPLAY_MAP[item.source] || item.source || '',
      sourceKey: item.source || '',
      category: item.category || '',
      size: item.size || '',
      type: item.type || '',
      tags: item.tags ? (Array.isArray(item.tags) ? item.tags : []) : [],
      tmdbId: item.tmdb_id || null,
      viewCount: item.view_count || 0,
      tmdb: item.tmdb_id ? (tmdbMap.get(item.tmdb_id) || null) : null,
      musicCover: item.category === '音乐' ? (musicCoverMap.get(item.id) || null) : null,
      coverCache: !item.tmdb_id ? (coverCacheMap.get(item.id) || null) : null,
    }));

    return NextResponse.json({
      total,
      page,
      pageSize,
      items,
      categories: zone === 'film' ? CATEGORIES : NONFILM_CATEGORIES,
      sources: ['全部', ...Object.values(SOURCE_DISPLAY_MAP)],
    });
  } catch (error: any) {
    console.error('Search error:', error.message);
    return NextResponse.json({ error: '搜索失败: ' + error.message }, { status: 500 });
  }
}
