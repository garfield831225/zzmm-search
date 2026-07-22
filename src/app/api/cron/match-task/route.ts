import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

const TMDB_KEY = process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const BATCH_PER_RUN = 200;

function getSql() {
  return neon(process.env.DATABASE_URL || '');
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────
function isEnglishName(name: string) {
  return /^[a-zA-Z\s\d.'-]+$/.test(name.trim());
}

function isGarbled(name: string) {
  let garbageLen = 0;
  for (let i = 0; i < name.length; i++) {
    const cp = name.codePointAt(i)!;
    if (cp === 0xfffd || cp === 0x3f) { garbageLen++; continue; }
    const inAscii = cp >= 0x20 && cp <= 0x7e;
    const inCJK = (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0xac00 && cp <= 0xd7af);
    const inPunct = [0x2e, 0x3001, 0x3002, 0x2018, 0x2019, 0xff08, 0xff09, 0x300a, 0x300b, 0x5b, 0x5d, 0x28, 0x29, 0x2d].includes(cp);
    if (!inAscii && !inCJK && !inPunct) garbageLen++;
  }
  return garbageLen / name.length > 0.4;
}

function chineseToNumber(str: string) {
  const map: Record<string, number> = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}

function cleanFolderName(nameStr: string) {
  let season: number | null = null;
  let s = nameStr.replace(/\s*\d{4}.*$/, '').trim();
  const sm = s.match(/第([一二三四五六七八九十\d]+)季|S(\d{1,2})/i);
  if (sm) season = sm[1] ? chineseToNumber(sm[1]) : parseInt(sm[2]);
  const pmMatch = s.match(/^\[([^\]]+)\]/);
  if (pmMatch) {
    const bracket = pmMatch[1];
    const parts = bracket.split('_');
    for (const p of parts) {
      if (/[\u4e00-\u9fff]/.test(p)) {
        const t = p.replace(/第\d+季/i,'').trim();
        if (t.length >= 2) { s = t; break; }
      }
    }
  }
  const bracketParts = Array.from(s.matchAll(/\[([^\]]+)\]/g));
  for (const m of bracketParts) {
    const c = m[1].trim();
    if (c.length >= 2 && /[\u4e00-\u9fff]/.test(c)) {
      if (/^(4k|8k|2160p|1080p|720p|480p|blu-?ray|bluray|bdmv|remux|web-?dl|hdtv|diy|美版|日版|港版|欧版|韩版|台版|hdr10|hdr|dolby|dts|atmos|truehd|aac|国语|英语|粤语|中字|字幕|配音|特效|简繁|双语)$/i.test(c)) continue;
      const t = c.replace(/\d{1,2}\.\d+G$/,'').trim();
      if (t.length >= 2) { s = t; break; }
    }
  }
  if (s.length < 2) {
    const dots = s.split('.');
    for (const p of dots) {
      const t = p.trim();
      if (t.length >= 2 && /[\u4e00-\u9fff]/.test(t)) {
        if (!/^(4K|8K|蓝光原盘|蓝光remux|HDTV|WEBRip|BluRay|DIY)$/i.test(t)) { s = t; break; }
      }
    }
  }
  if (s.length < 2) {
    const bm = s.match(/《([^》]+)》/);
    if (bm) { const t = bm[1].trim(); if (t.length >= 2) s = t; }
  }
  if (s.length < 2) {
    const frags = s.match(/[\u4e00-\u9fff][^\[\]（）【】《》\s]{0,30}/g);
    if (frags && frags.length > 0) {
      let best = '';
      for (const f of frags) { const ft = f.trim(); if (ft.length > best.length && ft.length >= 2) best = ft; }
      if (best) s = best;
    }
  }
  if (s.length < 2) {
    const tr = s.replace(/^[\[\]（）【】《》\s]+|[\[\]（）【】《》\s]+$/g,'').trim();
    if (tr.length >= 2 && !/[\u4e00-\u9fff]/.test(tr)) s = tr;
  }
  const cleanName = s.length < 2 ? nameStr : s;
  return { cleanName, season };
}

function normStr(s: string) {
  return s.toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').trim();
}

function bigramSet(s: string) {
  const cs = Array.from(s);
  const pairs: string[] = [];
  for (let i = 0; i < cs.length - 1; i++) pairs.push(cs[i] + cs[i + 1]);
  if (cs.length === 1) pairs.push(cs[0]);
  return pairs;
}

function titleSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  const a0 = normStr(a), b0 = normStr(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  const sA = bigramSet(a0), sB = bigramSet(b0);
  let inter = 0;
  for (let i = 0; i < sA.length; i++) { if (sB.includes(sA[i])) inter++; }
  const u = sA.length + sB.length - inter;
  return u === 0 ? 0 : inter / u;
}

function confidenceScore(cleanName: string, r: any, lang: string, searchYear: string | undefined) {
  if (cleanName.replace(/\s/g, '').length < 2) return 0;
  const zhNames = [r.title, r.original_title, r.name].filter(Boolean);
  const enName = r.title?.match(/[a-zA-Z]/) ? r.title : '';
  const allTitles = [...zhNames, enName].map(t => ({ raw: t, n: normStr(t) }));
  const cn = normStr(cleanName);

  // ① 精确匹配（归一化后完全相等）→ 1.0
  for (const t of allTitles) {
    if (t.n === cn) return 1.0;
  }
  // ② 包含匹配（归一化后 A包含B 或 B包含A）→ 0.9
  for (const t of allTitles) {
    if (t.n && (t.n.includes(cn) || cn.includes(t.n))) return 0.9;
  }
  // ③ bigram 相似度作为兜底
  const zhS = Math.max(0, ...zhNames.map(zn => titleSimilarity(cleanName, zn)));
  const enS = enName ? titleSimilarity(cleanName, enName) : 0;
  return Math.max(zhS, enS);
}

const MIN_CONF = 0.5;

function getTypesForCategory(category: string, sub_type: string | null, season: number | null) {
  if (season !== null) return ['tv'];
  if (category === '连载' || category === '剧集' || category === '动漫' || category === '少儿频道' || category === '综艺') return ['tv'];
  if (category === '演唱会' || category === '电影' || category === '系列电影') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(sub_type || '')) return ['movie'];
    return ['tv'];
  }
  if (category === 'REMUX') return ['movie'];
  return null;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function searchTMDBOne(query: string, type: string, lang: string, year?: string): Promise<any | null> {
  const yp = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
  const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(query)}&api_key=${TMDB_KEY}&language=${lang}${yp}&page=1&include_adult=false`;
  try {
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.results || []).slice(0, 5);
    for (const r of results) {
      const score = confidenceScore(query, r, lang, year);
      if (score >= MIN_CONF) return { id: String(r.id), type };
    }
    return null;
  } catch {
    return null;
  }
}

async function matchOneRecord(name: string, category: string, sub_type: string | null): Promise<string | null> {
  let name0 = name || '';
  if (isGarbled(name0)) return 'GARBLED';
  const { cleanName, season } = cleanFolderName(name0);
  if (cleanName.length < 2) return 'NOMATCH';
  const types = getTypesForCategory(category, sub_type, season);
  if (!types) return 'SKIP';
  const isEng = isEnglishName(cleanName);
  const strategies = isEng
    ? [{lang:'en-US', y:true},{lang:'en-US', y:false},{lang:'zh-CN', y:false}]
    : [{lang:'zh-CN', y:true},{lang:'zh-CN', y:false},{lang:'en-US', y:false}];
  for (const s of strategies) {
    for (const type of types) {
      await sleep(20);
      const result = await searchTMDBOne(cleanName, type, s.lang, s.y ? '' : undefined);
      if (result) return result.id;
    }
  }
  return 'NOMATCH';
}

// ─── 主逻辑 ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const sql = getSql();

    // 2026-07-21: 防 read replica lag - 业务匹配前先做一次主 endpoint 写
    // INSERT 一定走主 endpoint, 触发 Neon control plane 重新 routing
    // 这次 INSERT 也帮 catalog/search 端点下次 read 时能 read-your-writes 看到新数据
    try {
      await sql`
        INSERT INTO xx_activation_codes (code, code_type, plan_id, duration, channel, created_by, is_used, user_group)
        VALUES ('CRON-SYNC', 'cron', 'CRON', 1, 'cron', 'cron', false, 'admin')
        RETURNING id
      `.then((r: any) => {
        if (r?.[0]?.id) {
          sql`DELETE FROM xx_activation_codes WHERE id = ${r[0].id}`.catch(() => {});
        }
      });
    } catch {}

    // 2026-07-18: 完全绕开 xx_match_tasks 表 (Neon read replica lag 让 task 不可见)
    // 直接查未匹配资源, 5min 窗口去重, 跑 200/批
    const rows = await sql`
      SELECT id, name, category, sub_type
      FROM xx_resources
      WHERE tmdb_id IS NULL
        AND (matched_tmdb_at IS NULL OR matched_tmdb_at < NOW() - INTERVAL '5 minutes')
      ORDER BY id
      LIMIT ${BATCH_PER_RUN}
    `.catch(() => []) as any[];

    if (rows.length === 0) {
      return NextResponse.json({ done: true, msg: 'no unmatched resources' });
    }

    let batchMatched = 0;
    let batchNomatch = 0;

    // 2026-07-18: 20 并发匹配 (Vercel 60s 内能跑完 200 条)
    const CONCURRENCY = 20;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (row) => {
        const result = await matchOneRecord(row.name, row.category, row.sub_type);
        if (result === 'SKIP' || result === 'GARBLED') {
          await sql`UPDATE xx_resources SET tmdb_id = ${result}, matched_tmdb_at = NOW() WHERE id = ${row.id}`.catch(() => {});
          batchNomatch++;
        } else if (result === 'NOMATCH') {
          // 没匹配上不更新 tmdb_id, 但更新时间戳避免重复
          await sql`UPDATE xx_resources SET matched_tmdb_at = NOW() WHERE id = ${row.id}`.catch(() => {});
          batchNomatch++;
        } else {
          await sql`UPDATE xx_resources SET tmdb_id = ${result}, matched_tmdb_at = NOW() WHERE id = ${row.id}`.catch(() => {});
          batchMatched++;
        }
      }));
    }

    // 2026-07-18: 简化, 不依赖 xx_match_tasks 表 (绕过 read replica lag)
    return NextResponse.json({
      processed: rows.length,
      matched: batchMatched,
      nomatch: batchNomatch,
      done: false,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}