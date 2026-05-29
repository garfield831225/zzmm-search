/**
 * DEBUG TMDB 匹配 - 针对问题数据验证匹配逻辑
 * 运行: DATABASE_URL=xxx TMDB_API_KEY_1=xxx DRY_RUN=true DEBUG=true node scripts/debug-match.mjs
 */
import { neon } from '@neondatabase/serverless';
import { execFile } from 'child_process';
import { promisify } from 'util';

const CURL = 'C:/Windows/System32/curl.exe';
const execFileAsync = promisify(execFile);

const TMDB_KEYS = [process.env.TMDB_API_KEY_1 || '7985342d5961e9ee3d5ef6d969c1b8dd'];
const TMDB_BASE = 'https://api.themoviedb.org/3';
const HTTP_PROXY = process.env.HTTP_PROXY || 'http://127.0.0.1:7897';

async function curlFetch(url) {
  try {
    const { stdout } = await execFileAsync(CURL, ['-s', '--connect-timeout', '10', '-x', HTTP_PROXY, url]);
    return JSON.parse(stdout || '{}');
  } catch {
    return {};
  }
}

function isEnglishName(name) {
  return /^[a-zA-Z\s\d.'-]+$/.test(name.trim());
}

function chineseToNumber(str) {
  const map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}

function cleanFolderName(folderName) {
  let searchTitle = folderName;
  const ptMatch = folderName.match(/^\[([^\]]+)\]/);
  if (ptMatch) {
    const parts = ptMatch[1].split('_');
    const chinesePart = parts.find(p => /[\u4e00-\u9fff]/.test(p));
    if (chinesePart) searchTitle = chinesePart;
  }

  let extractedYear = '';
  const yearCandidates = [...searchTitle.matchAll(/\b(20\d{2})\b/g)];
  for (const m of yearCandidates) {
    const y = parseInt(m[1]);
    if (y >= 1900 && y <= 2030) { extractedYear = m[1]; break; }
  }

  let season = null;
  const seasonPatterns = [/第([一二三四五六七八九十\d]+)季/i, /Season\s*(\d+)/i, /S(\d{1,2})E\d+/i, /S(\d{1,2})$/i];
  for (const pat of seasonPatterns) {
    const m = searchTitle.match(pat);
    if (m) { season = chineseToNumber(m[1]); break; }
  }

  let cleanName = searchTitle
    .replace(/第[一二三四五六七八九十\d]+季/gi, '')
    .replace(/Season\s*\d+/gi, '')
    .replace(/S\d{1,2}E\d+/gi, '')
    .replace(/S\d{1,2}$/gi, '')
    .replace(/【([^】]+)】/g, '')
    .replace(/《([^》]+)》/g, '')
    .replace(/（([^）]+)）/g, '')
    .replace(/\(([^)]+)\)/g, '')
    .replace(/\[([^\]]+)\]/g, '');

  const noisePatterns = [
    /2160p|1080p|720p|480p/gi, /WEB-DL|BluRay|BDRip|HDTV|WEBRip|REMUX|Blu-ray|BDMV/gi,
    /H265|H264|HEVC|AVC|x264|x265/gi,
    /杜比视界|杜比全景声|DV|HDR10\+|HDR10|HDR|ATMOS|DDP5\.1|DDP|DTS-HD|DTS|AAC5\.1|AAC|TrueHD|EAC3/gi,
    /国语中字|中英双字|中英字幕|双语字幕|外挂字幕|国语配音|中文字幕|中字|字幕|粤语|台配|配音/gi,
    /导演剪辑版|导演剪辑|加长版|完整版|未删减版|剧场版|REMUX/gi,
    /IMAX|SDR|AC3/gi, /蓝光原盘|蓝光|蓝光remux|HD|内嵌|封包|封装/gi,
    /DIY|次时代|官译|特效字幕|双语|简繁|繁简/gi,
    /CEE|美版|日版|港版|韩版|欧版|台版/gi,
    /Athena@|CHDBits@|HDSky@|HDHome@|ltzww@/gi,
  ];
  for (const pat of noisePatterns) cleanName = cleanName.replace(pat, ' ');

  cleanName = cleanName.replace(/\.(mkv|mp4|avi|ts|m2ts|wmv|flv)$/gi, '');
  cleanName = cleanName.replace(/\./g, ' ').replace(/\?/g, '').replace(/\s+/g, ' ').trim();

  return { cleanName, year: extractedYear, season };
}

function titleSimilarity(a, b) {
  if (!a || !b) return 0;
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').trim();
  const a0 = norm(a), b0 = norm(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  const bigrams = (s) => {
    const cs = [...s];
    const bg = new Set();
    for (let i = 0; i < cs.length - 1; i++) bg.add(cs[i] + cs[i + 1]);
    if (cs.length === 1) bg.add(cs[0]);
    return bg;
  };
  const setA = bigrams(a0), setB = bigrams(b0);
  let inter = 0;
  for (const v of setA) if (setB.has(v)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function confidenceScore(cleanName, tmdbResult, searchLang, searchYear) {
  const cleanLen = cleanName.replace(/\s/g, '').length;
  if (cleanLen < 3) return 0;

  const zhNames = [tmdbResult.title, tmdbResult.original_title, tmdbResult.name].filter(Boolean);
  const enName = (tmdbResult.title?.match(/[a-zA-Z]/) ? tmdbResult.title : '') || '';
  const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const cleanNorm = norm(cleanName);
  const allTitles = [...zhNames, enName].map(t => ({ raw: t, norm: norm(t) }));

  const zhScore = Math.max(...zhNames.map(zn => titleSimilarity(cleanName, zn)));
  const enScore = enName ? titleSimilarity(cleanName, enName) : 0;
  let bestScore = Math.max(zhScore, enScore);

  let substringBonus = 0;
  for (const t of allTitles) {
    if (t.norm.length >= 2 && (t.norm.includes(cleanNorm) || cleanNorm.includes(t.norm))) {
      substringBonus = 0.1;
      break;
    }
  }

  let exactBonus = 0;
  for (const t of allTitles) {
    if (t.raw === cleanName) { exactBonus = 1.0; break; }
  }
  if (exactBonus === 0) {
    for (const t of allTitles) {
      if (t.norm.includes(cleanNorm) || cleanNorm.includes(t.norm)) { exactBonus = 0.85; break; }
    }
  }
  if (exactBonus > 0) bestScore = Math.max(bestScore, exactBonus);

  let yearBonus = 0;
  const resultYear = (tmdbResult.release_date || tmdbResult.first_air_date || '').slice(0, 4);
  if (searchYear && resultYear && Math.abs(parseInt(resultYear) - parseInt(searchYear)) <= 2) {
    yearBonus = 0.1;
  }

  return bestScore + substringBonus + yearBonus;
}

const MIN_CONFIDENCE = 0.5;

async function searchTmdb(name, type, year, lang, keyIndex) {
  await new Promise(r => setTimeout(r, 50));
  const endpoint = type === 'tv' ? '/search/tv' : '/search/movie';
  const yearParam = year ? (type === 'tv' ? `&first_air_date_year=${year}` : `&primary_release_year=${year}`) : '';
  const url = `${TMDB_BASE}${endpoint}?query=${encodeURIComponent(name)}&api_key=${TMDB_KEYS[keyIndex]}&language=${lang}${yearParam}&page=1&include_adult=false`;
  
  console.log(`  [TMDB-URL] ${url}`);
  const data = await curlFetch(url);
  const top5 = data.results?.slice(0, 5) || [];
  console.log(`  [TMDB-RESULTS] ${top5.map(r => `"${r.title||r.name||''}(${r.release_date||'?'})" id=${r.id}`).join(' | ')}`);
  return top5;
}

async function matchSegment(segName) {
  const { cleanName, year, season } = cleanFolderName(segName);
  console.log(`\n  [cleanFolderName] input="${segName}" -> cleanName="${cleanName}" year="${year}" season="${season}"`);

  if (cleanName.length < 2) return null;

  const isEng = isEnglishName(cleanName);
  console.log(`  [isEng] ${isEng}`);
  const strategies = isEng
    ? [{ lang: 'en-US', useYear: true }, { lang: 'en-US', useYear: false }]
    : [{ lang: 'zh-CN', useYear: true }, { lang: 'zh-CN', useYear: false }, { lang: 'en-US', useYear: false }];

  const typeOrder = season !== null ? ['tv'] : ['movie', 'tv'];

  for (const s of strategies) {
    for (const type of typeOrder) {
      const results = await searchTmdb(cleanName, type, s.useYear ? year : undefined, s.lang, 0);
      if (!results?.length) continue;

      for (const result of results) {
        const score = confidenceScore(cleanName, result, s.lang, s.useYear ? year : undefined);
        console.log(`    [SCORE] title="${result.title||result.name}" score=${score.toFixed(3)} (zhScore=${titleSimilarity(cleanName, result.title||'').toFixed(3)} exact=${result.title===cleanName ? 'MATCH' : 'no'} yearDiff=${year&&result.release_date ? Math.abs(parseInt(year)-parseInt(result.release_date.slice(0,4))) : 'n/a'})`);
        
        if (score >= MIN_CONFIDENCE) {
          return { id: String(result.id), tmdb_type: type, poster: result.poster_path ? `https://image.tmdb.org/t/p/w500${result.poster_path}` : '', title: result.title || result.name || cleanName, vote: result.vote_average || 0, year: (result.release_date || result.first_air_date || '').slice(0, 4) || year, score };
        }
      }
    }
  }
  return null;
}

async function main() {
  const sql = neon(process.env.DATABASE_URL);
  
  // 取最近更新且未匹配的电影
  const rows = await sql`
    SELECT id, name, category
    FROM xx_resources 
    WHERE status = 'active' AND tmdb_id ~ '^[0-9]+$' AND (tmdb_id::bigint) = 0
      AND category = '电影'
    ORDER BY updated_at DESC
    LIMIT 30
  `;
  
  console.log(`\n=== DEBUG MATCH: ${rows.length} 电影未匹配数据 ===\n`);
  
  for (const row of rows) {
    console.log(`\n▼ RAW: "${row.name}"`);
    
    const segments = row.name.split(/[\[\]]/).filter(s => s.trim().length >= 2);
    console.log(`  [segments] ${segments.join(' | ')}`);
    
    let bestResult = null;
    let bestScore = -1;
    
    for (const seg of segments) {
      const result = await matchSegment(seg.trim());
      if (result && result.score > bestScore) {
        bestScore = result.score;
        bestResult = result;
      }
    }
    
    if (bestResult) {
      console.log(`  ★ FINAL: "${bestResult.title}" (tmdb_id=${bestResult.id} score=${bestResult.score.toFixed(3)})`);
    } else {
      console.log(`  ✗ NO MATCH`);
    }
  }
  
  console.log('\n=== DONE ===');
}

main().catch(console.error);