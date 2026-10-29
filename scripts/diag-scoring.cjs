// 同一批 TMDB 返回值, 用 engine 规则 vs worker 规则分别打分 → 定位差在哪 (2026-10-29)
const path = require('node:path');
const { Client } = require('ssh2');
const ROOT = path.resolve(__dirname, '..');
function req(name) {
  for (const p of [path.join(ROOT, 'node_modules', name), path.join('C:\\temp_zzmm', 'node_modules', name), name]) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error('找不到模块 ' + name);
}
const NAS = { host: '192.168.3.8', port: 10000, user: '13381064903', pass: process.env.NAS_PASS || '@G831225dd' };
const TMDB_KEYS = ['7985342d5961e9ee3d5ef6d969c1b8dd', '79e41efe870e60afb09b9de8baa47cf1'];
const TMDB_BASE = 'https://api.themoviedb.org/3';

function sshRun(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = '', stderr = '';
      stream.on('data', c => { stdout += c.toString(); });
      stream.stderr.on('data', c => { stderr += c.toString(); });
      stream.on('close', code => resolve({ code, stdout, stderr }));
    });
  });
}
const norm = (s) => (s || '').toLowerCase().replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '').trim();
function bigramSet(s) { const cs = Array.from(s); const p = []; for (let i = 0; i < cs.length - 1; i++) p.push(cs[i] + cs[i + 1]); if (cs.length === 1) p.push(cs[0]); return p; }
function bigramSim(a, b) {
  const a0 = norm(a), b0 = norm(b);
  if (!a0 || !b0) return 0;
  if (a0 === b0) return 1;
  const sA = bigramSet(a0), sB = bigramSet(b0);
  let inter = 0;
  for (const x of sA) if (sB.includes(x)) inter++;
  const u = sA.length + sB.length - inter;
  return u === 0 ? 0 : inter / u;
}

// ── engine 的规则 (src/app/api/cron/match-task/route.ts 的 confidenceScore) ──
function engineScore(cleanName, r) {
  const zhNames = [r.title, r.original_title, r.name].filter(Boolean);
  const enName = r.title?.match(/[a-zA-Z]/) ? r.title : '';
  const allTitles = [...zhNames, enName].map(t => ({ raw: t, n: norm(t) }));
  const cn = norm(cleanName);
  if (cn.replace(/\s/g, '').length < 2) return 0;
  for (const t of allTitles) if (t.n === cn) return 1.0;
  for (const t of allTitles) if (t.n && (t.n.includes(cn) || cn.includes(t.n))) return 0.9;
  const zhS = Math.max(0, ...zhNames.map(zn => bigramSim(cleanName, zn)));
  const enS = enName ? bigramSim(cleanName, enName) : 0;
  return Math.max(zhS, enS);
}

// ── worker 的规则 ──
function workerScore(cleanName, r) {
  const zh = r.title || r.name || '';
  const en = r.original_title || r.original_name || '';
  const cn = norm(cleanName);
  let tier = 'none', score = 0;
  for (const t of [zh, en]) {
    if (!t) continue;
    const tn = norm(t);
    if (!tn) continue;
    if (tn === cn) return { tier: 'exact', score: 100 };
    if (tn.startsWith(cn) && cn.length >= 2) { if (score < 90) { tier = 'prefix'; score = 90; } continue; }
    if (cn.length >= 3 && tn.includes(cn) && tn.length - cn.length <= 6) { if (score < 80) { tier = 'substr'; score = 80; } continue; }
    const sim = bigramSim(cn, tn);
    if (sim >= 0.5 && score < 60) { tier = 'bigram'; score = Math.round(sim * 60); continue; }
  }
  return { tier, score };
}

(async () => {
  const N = parseInt(process.argv[2] || '25', 10);
  const worker = require(path.join(__dirname, 'rematch-worker.cjs'));
  const CATS = '动漫,短剧,剧集,电影,原盘,纪录片,综艺,演唱会,系列电影';

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res); conn.on('error', rej);
    conn.connect({ host: NAS.host, port: NAS.port, username: NAS.user, password: NAS.pass, readyTimeout: 30000,
      algorithms: { kex: ['curve25519-sha256', 'diffie-hellman-group14-sha1'] } });
  });
  const sql = `SELECT row_to_json(t)::text FROM (
    SELECT id, name, category, COALESCE(sub_type,'') AS sub_type
    FROM xx_resources
    WHERE status='active' AND tmdb_id='NOMATCH' AND category IN (${CATS.split(',').map(c => `'${c}'`).join(',')})
    ORDER BY id
  ) t LIMIT ${N * 4}`;
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const pull = await sshRun(conn, [
    `echo "${b64}" | base64 -d > /tmp/_g.sql`,
    `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 -t -A -f /dev/stdin < /tmp/_g.sql" 2>&1`,
  ].join('\n'));
  conn.end();
  const rows = [];
  for (const ln of pull.stdout.split('\n')) {
    const s = ln.trim();
    if (s.startsWith('{')) { try { rows.push(JSON.parse(s)); } catch { } }
  }
  const step = Math.max(1, Math.floor(rows.length / N));
  const sample = [];
  for (let i = 0; i < rows.length && sample.length < N; i += step) sample.push(rows[i]);

  let eHit = 0, wHit = 0, diffOnly = 0;
  for (const r of sample) {
    const c = worker.cleanFolderName(r.name);
    const types = worker.typesFor(r.category, r.sub_type || null, c.season);
    console.log('─'.repeat(96));
    console.log(`原名: ${String(r.name).replace(/\n/g, ' ').slice(0, 76)}`);
    console.log(`清洗: "${c.cleanName}" year=${c.year || '-'} season=${c.season ?? '-'} alts=${JSON.stringify(c.alts)}  types=${JSON.stringify(types)}`);
    if (!types) { console.log('跳过'); continue; }
    const names = [c.cleanName, ...(c.alts || [])].filter(x => x && x.length >= 2).slice(0, 3);
    let eBest = null, wBest = null;
    for (const nm of names) {
      for (const type of types) {
        for (const lang of ['zh-CN', 'en-US']) {
          const yp = c.year ? (type === 'tv' ? `&first_air_date_year=${c.year}` : `&primary_release_year=${c.year}`) : '';
          const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(nm)}&api_key=${TMDB_KEYS[0]}&language=${lang}&page=1&include_adult=false${yp}`;
          let d = null;
          try { d = await (await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })).json(); } catch { }
          const res = (d && d.results ? d.results : []).slice(0, 8);
          if (!res.length) continue;
          console.log(`  [${lang}${yp ? '+year' : ''}] "${nm}" (${type}) → ${res.length} 候选`);
          for (const x of res) {
            const es = engineScore(nm, x);
            const ws = workerScore(nm, x);
            const mark = es >= 0.5 && !(ws.tier !== 'none') ? '  ←★只有engine认' : (ws.tier !== 'none' && es < 0.5 ? '  ←★只有worker认' : '');
            console.log(`      ${String(x.id).padStart(7)} ${(x.title || x.name || '').padEnd(30)} engine=${es.toFixed(2)} worker=${ws.tier}/${ws.score}${mark}`);
            if (es >= 0.5 && (!eBest || es > eBest.es)) eBest = { x, es, nm, type };
            if (ws.tier !== 'none' && (!wBest || ws.score > wBest.ws.score)) wBest = { x, ws, nm, type };
          }
          if (eBest) break;   // engine 命中就停 (engine 是"第一个 >=0.5 就返回")
        }
        if (eBest) break;
      }
      if (eBest) break;
    }
    if (eBest) eHit++;
    if (wBest) wHit++;
    if (eBest && !wBest) { diffOnly++; console.log(`  >>> engine 命中但 worker 没认: ${eBest.x.title || eBest.x.name} (${eBest.type} ${eBest.x.id})`); }
    else if (wBest && !eBest) console.log(`  >>> worker 命中但 engine 没认: ${wBest.x.title || wBest.x.name}`);
  }
  console.log(`\n=== 汇总 (${sample.length} 条) ===`);
  console.log(`  engine 命中 ${eHit} (${(100 * eHit / sample.length).toFixed(1)}%)`);
  console.log(`  worker 命中 ${wHit} (${(100 * wHit / sample.length).toFixed(1)}%)`);
  console.log(`  engine独中 ${diffOnly}`);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
