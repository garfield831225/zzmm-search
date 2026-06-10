// 快速导入: 粘 CSV / 粘链接, 单端点支持两种
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

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

// 智能分类 (基于片名关键字)
function guessCategory(name: string, hint?: string): string {
  // 1. 优先用 hint
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
// 支持格式:
//   "片名","链接","提取码","分类" (带引号 CSV)
//   片名,链接,提取码,分类 (无引号)
//   片名\t链接\t提取码\t分类 (TSV)
//   片名, 链接, 提取码 (无分类列 → 自动猜)
//   片名  链接  提取码  (空格分隔)
function parseText(text: string, defaultHint?: string): any[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
  if (!lines.length) return [];

  // 检测分隔符: 第一行同时含 \t 和 , 时优先 \t; 否则看表头列名
  const firstLine = lines[0];
  let sep: string | RegExp = ',';
  if (firstLine.includes('\t')) {
    sep = /\t/;
  } else if (firstLine.includes('||')) {
    sep = /\|\|/; // 双竖线也常见
  }

  // 检测表头 (常见关键字)
  const isHeader = /(片名|名称|名字|title|链接|url|提取码|code|密码|password|分类|category|大小|size)/i.test(firstLine);

  const dataLines = isHeader ? lines.slice(1) : lines;
  const items: any[] = [];

  for (const line of dataLines) {
    // CSV 引号处理: "片名","链接"
    const cols = splitCsvLine(line, sep);
    if (cols.length < 2) continue;

    const name = (cols[0] || '').trim();
    let link = (cols[1] || '').trim();
    // 清理行内引号
    name.replace(/^["']|["']$/g, '');
    link.replace(/^["']|["']$/g, '');

    if (!name || !link) continue;
    // 链接基本校验
    if (!/^(https?:|magnet:|ed2k:|thunder:)/i.test(link)) continue;

    // 提取码
    let linkCode = cols[2] ? cols[2].trim().replace(/^["']|["']$/g, '') : '';
    if (!linkCode) linkCode = extractLinkCode(link);

    // 分类
    const category = (cols[3] || '').trim().replace(/^["']|["']$/g, '') || guessCategory(name, defaultHint);

    items.push({
      name,
      link,
      link_code: linkCode,
      source: detectSource(link),
      category,
      size: cols[4] ? cols[4].trim().replace(/^["']|["']$/g, '') : '',
    });
  }
  return items;
}

// 简易 CSV 行解析 (处理引号)
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

    // 写库 (复用现有 xx_resources 结构)
    const sql = neon(process.env.DATABASE_URL || '');
    const BATCH = 200;
    let imported = 0, failed = 0;
    const failures: any[] = [];

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      // 7 字段 + import_channel 字面量 (避免 $N 类型推断失败)
      const cols = 'name, link, link_code, source, category, size, type, tags, tmdb_id, imdb_id, status, valid_status, view_count, created_at, updated_at, import_channel';
      const vals = batch.map((_: any, idx: number) => {
        const base = idx * 7;
        return `($${base+1}, $${base+2}, $${base+3}, $${base+4}, $${base+5}, $${base+6}, DEFAULT, '{}', NULL, NULL, 'active', 'unchecked', 0, NOW(), NOW(), 'quick-paste'::text)`;
      }).join(', ');
      const params: any[] = batch.flatMap((it: any) => [
        it.name, it.link, it.link_code || '', it.source || 'other',
        it.category || '其他', it.size || '',
      ]);
      try {
        const r = await sql(
          `INSERT INTO xx_resources (${cols}) VALUES ${vals} ON CONFLICT (link) WHERE link IS NOT NULL AND link != '' DO NOTHING RETURNING id`,
          params
        );
        imported += (r as any[]).length;
      } catch (e: any) {
        failed += batch.length;
        failures.push({ batch: Math.floor(i / BATCH) + 1, error: e.message?.slice(0, 200) });
      }
    }

    // 统计按来源/分类
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
      imported,
      failed,
      failures: failures.length ? failures : undefined,
      by_source: bySource,
      by_category: byCategory,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
