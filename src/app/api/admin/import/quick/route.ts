// 快速导入: 粘 CSV / 粘链接, 单端点支持两种
// 2026-07-31: 剧集识别 - 连续同名行合并成 1 resource + N link (写副表 xx_resource_links)
// 业务规则: 1 剧 1 resource, 18 个 link 是不同 season/episode
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { inferDocSheetFromCategory } from '@/lib/sheet-mapping';

export const dynamic = 'force-dynamic';

// 自动识别链接类型 (115 / 百度 / 阿里 / 磁力 / ed2k / 迅雷)
function detectSource(link: string): string {
  if (!link) return 'other';
  const l = link.toLowerCase();
  if (l.includes('115.com') || l.includes('anxia.com') || l.includes('115cdn.com')) return '115网盘';
  if (l.includes('pan.baidu.com')) return '百度网盘';
  if (l.includes('alipan.com') || l.includes('aliyundrive.com')) return '阿里云盘';
  if (l.includes('magnet:?')) return '磁力链接';
  if (l.includes('ed2k://')) return 'ed2k';
  if (l.includes('thunder://')) return '迅雷';
  if (l.includes('pan.xunlei.com') || l.includes('xunlei.com')) return '迅雷云盘';
  if (l.includes('quark.cn') || l.includes('drive.quark.cn')) return '夸克网盘';
  if (l.includes('lanzou')) return '蓝奏云';
  return 'other';
}

// 提取 115/网盘 链接里的提取码 (?password=xxx 或 ?code=xxx)
function extractLinkCode(link: string): string {
  if (!link) return '';
  const m = link.match(/[?&#](?:password|code|p|extract|key)=([^&#\s]+)/i);
  return m ? decodeURIComponent(m[1]) : '';
}

// 从 ed2k/magnet 文件名提取 SxxExx (返回 {season, episode} 或 null)
function extractSeasonEpisode(link: string): { season: number; episode: number } | null {
  if (!link) return null;
  // 常见模式:
  //   ed2k://|file|Xiao.Fang.S01E01.2026.2160p...|...|/  → S01E01
  //   magnet:?xt=urn:btih:...&dn=Xiao.Fang.S01E01...    → S01E01
  //   &dn=... 也可能在 url query
  const m = link.match(/[.\-_]?S(\d{1,2})E(\d{1,3})(?:\.|_|-|E|$|&)/i)
         || link.match(/[.\-_]?S(\d{1,2})\.?E(\d{1,3})/i);
  if (m) {
    return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  }
  // 兜底: 纯 EPxx (动漫常见, 没 S 标)
  const epOnly = link.match(/[.\-_]?EP?(\d{1,3})(?:\.|_|-|E|$|&)/i);
  if (epOnly) {
    return { season: 1, episode: parseInt(epOnly[1]) };
  }
  return null;
}

// 智能分类 (基于片名关键字)
function guessCategory(name: string, hint?: string): string {
  if (hint) return hint;
  const n = (name || '').toLowerCase();
  if (/s\d{1,2}e\d{1,3}/.test(n) || /season|全集|剧集|剧场版|^s\d/.test(n)) return '剧集';
  if (/电影|bdrip|bluray|hdrip|web-dl|dvdrip|remux|1080p|2160p|4k|2160|720p/i.test(n)) return '电影';
  if (/动漫|动画|ova|ona|sp\d|bd\b/i.test(n)) return '动漫';
  if (/综艺|variety|show|talkshow|脱口秀|演唱会|concert/i.test(n)) return '综艺';
  if (/演唱会|live|concert|巡演/i.test(n)) return '演唱会';
  if (/纪录|docu/i.test(n)) return '纪录片';
  if (/原盘|uhd|iso/i.test(n)) return '原盘';
  if (/remux/i.test(n)) return 'REMUX';
  if (/连载|更新/i.test(n)) return '连载';
  if (/合集|套装|box|collection/i.test(n)) return '合集';
  if (/少儿|儿歌|动画.*儿|幼儿/i.test(n)) return '少儿频道';
  return '其他';
}

// 解析 CSV/TSV 文本
function parseText(text: string, defaultHint?: string): any[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  if (!lines.length) return [];

  const firstLine = lines[0];
  let sep: string | RegExp = ',';
  if (firstLine.includes('\t')) {
    sep = /\t/;
  } else if (firstLine.includes('||')) {
    sep = /\|\|/;
  }

  const isHeader = /(片名|名称|名字|title|链接|url|提取码|code|密码|password|分类|category|大小|size)/i.test(firstLine);

  const dataLines = isHeader ? lines.slice(1) : lines;
  const items: any[] = [];

  for (const line of dataLines) {
    const cols = splitCsvLine(line, sep);
    if (cols.length < 2) continue;

    const name = (cols[0] || '').trim();
    let link = (cols[1] || '').trim();
    name.replace(/^["']|["']$/g, '');
    link.replace(/^["']|["']$/g, '');

    if (!name || !link) continue;
    if (!/^(https?:|magnet:|ed2k:|thunder:)/i.test(link)) continue;

    let linkCode = cols[2] ? cols[2].trim().replace(/^["']|["']$/g, '') : '';
    if (!linkCode) linkCode = extractLinkCode(link);

    const category = (cols[3] || '').trim().replace(/^["']|["']$/g, '') || guessCategory(name, defaultHint);
    const se = extractSeasonEpisode(link);

    items.push({
      name,
      link,
      link_code: linkCode,
      source: detectSource(link),
      category,
      size: cols[4] ? cols[4].trim().replace(/^["']|["']$/g, '') : '',
      season: se?.season || 0,
      episode: se?.episode || 0,
    });
  }
  return items;
}

function splitCsvLine(line: string, sep: string | RegExp): string[] {
  const cols: string[] = [];
  let cur = '';
  let inQuote = false;
  let i = 0;
  const sepChar = typeof sep === 'string' ? sep : null;
  const sepRegex = sep instanceof RegExp ? sep : null;

  while (i < line.length) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"' && cur === '') { inQuote = true; i++; continue; }
      if (sepChar && c === sepChar) { cols.push(cur); cur = ''; i++; continue; }
      if (sepRegex && sepRegex.test(c)) { cols.push(cur); cur = ''; i++; continue; }
      cur += c; i++;
    }
  }
  cols.push(cur);
  return cols.map(c => c.trim());
}

// 2026-07-31: 合并连续同名行 (剧集模式) → 1 resource + N links
// 规则: items 数组里连续相同 name 的行合并到同一 resource
// 返回: { resources: [{name, category, size, doc_sheet, primary_source, primary_link, primary_code}], links: [{resource_name, source, url, password, season, episode}] }
function groupSeriesItems(items: any[]): { resources: any[]; links: any[] } {
  const resources: any[] = [];
  const links: any[] = [];
  let currentRes: any = null;

  for (const it of items) {
    if (!currentRes || currentRes.name !== it.name) {
      // 新剧开始 (也可能是单条电影的 resource)
      // 仅当 link 文件名提取到 SxxExx 时认为是剧集, 走副表模式
      if (it.season > 0 || it.episode > 0) {
        currentRes = {
          name: it.name,
          category: it.category,
          size: it.size,
          doc_sheet: it.doc_sheet || inferDocSheetFromCategory(it.category),
          // 副表模式: 主表不带 link (写空)
          primary_source: null,
          primary_link: null,
          primary_code: null,
        };
        resources.push(currentRes);
        links.push({
          resource_name: it.name,
          source: it.source,
          url: it.link,
          password: it.link_code || '',
          season: it.season,
          episode: it.episode,
        });
      } else {
        // 单条 link (电影/单文件) - 走主表模式
        currentRes = {
          name: it.name,
          category: it.category,
          size: it.size,
          doc_sheet: it.doc_sheet || inferDocSheetFromCategory(it.category),
          primary_source: it.source,
          primary_link: it.link,
          primary_code: it.link_code || '',
        };
        resources.push(currentRes);
      }
    } else {
      // 同一剧后续行 - 加到副表
      links.push({
        resource_name: it.name,
        source: it.source,
        url: it.link,
        password: it.link_code || '',
        season: it.season,
        episode: it.episode,
      });
    }
  }
  return { resources, links };
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const mode: string = body.mode || 'paste';
    const defaultCategory: string | undefined = body.category || undefined;

    let items: any[] = [];
    if (mode === 'csv' || mode === 'paste') {
      const text: string = body.text || '';
      if (!text.trim()) {
        return NextResponse.json({ error: '请粘贴文本' }, { status: 400 });
      }
      items = parseText(text, defaultCategory);
    } else {
      return NextResponse.json({ error: `未知 mode: ${mode} (支持 csv / paste)` }, { status: 400 });
    }

    if (items.length === 0) {
      return NextResponse.json({
        error: '解析后无有效数据 (请检查格式: 每行 片名,链接,提取码)',
        parsed: 0,
      }, { status: 400 });
    }

    // 2026-07-31: 合并剧集 (连续同名行) → resources + links 双写
    const { resources, links } = groupSeriesItems(items);
    const sql = neon(process.env.DATABASE_URL || '');
    let resourcesImported = 0, linksImported = 0, failed = 0;
    const failures: any[] = [];
    const resourceIdByName = new Map<string, number>();

    // 1. 写 xx_resources (批量)
    const BATCH = 200;
    for (let i = 0; i < resources.length; i += BATCH) {
      const batch = resources.slice(i, i + BATCH);
      // 字段: name, link, link_code, source, category, size, doc_sheet + 默认列
      const cols = 'name, link, link_code, source, category, size, doc_sheet, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at, import_channel';
      const vals = batch.map((_: any, idx: number) => {
        const base = idx * 7;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, $${base+7}, DEFAULT, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW(), 'quick-paste'::text)`;
      }).join(', ');
      const params: any[] = batch.flatMap((it: any) => {
        return [it.name, it.primary_link || '', it.primary_code || '', it.primary_source || 'other', it.category, it.size || '', it.doc_sheet];
      });
      try {
        const r = await sql(
          `INSERT INTO xx_resources (${cols}) VALUES ${vals} ON CONFLICT (link) WHERE link IS NOT NULL AND link != '' DO NOTHING RETURNING id, name`,
          params
        );
        for (const row of r as any[]) {
          resourcesImported++;
          if (row.name) resourceIdByName.set(row.name, row.id);
        }
      } catch (e: any) {
        failed += batch.length;
        failures.push({ stage: 'resources', batch: Math.floor(i / BATCH) + 1, error: e.message?.slice(0, 200) });
      }
    }

    // 2. 写 xx_resource_links 副表 (剧集多集)
    if (links.length > 0) {
      // 处理 ON CONFLICT (link) — 副表没 UNIQUE on url, 但 resource_id+source+season+episode 4 字段 UNIQUE
      // 用 INSERT ... ON CONFLICT DO UPDATE 处理 (UPDATE 是为了 retry 安全)
      for (let i = 0; i < links.length; i += BATCH) {
        const batch = links.slice(i, i + BATCH);
        // 1) 先查每个 resource_name 对应的 id
        const names = Array.from(new Set(batch.map((l: any) => l.resource_name)));
        // 用 SQL 一次性查
        const idRows = await sql`SELECT id, name FROM xx_resources WHERE name = ANY(${names})`;
        const nameToId = new Map<string, number>();
        for (const r of idRows as any[]) nameToId.set(r.name, r.id);
        // 如果 ON CONFLICT 之前没创建 (上面 ON CONFLICT DO NOTHING 跳过), 这里 idRows 也能找到 (旧数据)
        // 2) INSERT 副表
        const validBatch = batch.filter((l: any) => nameToId.has(l.resource_name));
        if (validBatch.length === 0) continue;
        const linkCols = 'resource_id, source, url, password, sort, status, access_level, season, episode, created_at, updated_at';
        const linkVals = validBatch.map((_: any, idx: number) => {
          const base = idx * 7;
          return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, 1, 'active', 'basic', $${base+5}, $${base+6}, NOW(), NOW())`;
        }).join(', ');
        const linkParams: any[] = [];
        for (const l of validBatch) {
          linkParams.push(nameToId.get(l.resource_name), l.source, l.url, l.password || '', l.season || 0, l.episode || 0);
        }
        try {
          const r = await sql(
            `INSERT INTO xx_resource_links (${linkCols}) VALUES ${linkVals} ON CONFLICT (resource_id, source, season, episode) DO UPDATE SET url = EXCLUDED.url, password = EXCLUDED.password, updated_at = NOW() RETURNING id`,
            linkParams
          );
          linksImported += (r as any[]).length;
        } catch (e: any) {
          failed += validBatch.length;
          failures.push({ stage: 'links', batch: Math.floor(i / BATCH) + 1, error: e.message?.slice(0, 200) });
        }
      }
    }

    // 统计
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const it of items) {
      bySource[it.source] = (bySource[it.source] || 0) + 1;
      byCategory[it.category] = (byCategory[it.category] || 0) + 1;
    }

    return NextResponse.json({
      success: true,
      mode,
      parsed: items.length,
      resources_imported: resourcesImported,
      links_imported: linksImported,
      resources_total: resources.length,
      links_total: links.length,
      failed,
      failures: failures.length ? failures : undefined,
      by_source: bySource,
      by_category: byCategory,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
