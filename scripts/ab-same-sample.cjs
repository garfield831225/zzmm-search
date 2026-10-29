// 同口径对比: worker 版 vs engine 版 (同一批影视类样本, 同样本同时序)
// ⚠️ 给全局 fetch 加超时, 避免 engine 的无超时 fetch 卡死
const path = require('node:path');
const { Client } = require('ssh2');
const ROOT = path.resolve(__dirname, '..');
function req(name) {
  for (const p of [path.join(ROOT, 'node_modules', name), path.join('C:\\temp_zzmm', 'node_modules', name), name]) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error('找不到模块 ' + name);
}
const esbuild = req('esbuild');
const NAS = { host: '192.168.3.8', port: 10000, user: '13381064903', pass: process.env.NAS_PASS || '@G831225dd' };

// fetch 超时包装
const origFetch = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => origFetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(20000) });

function loadEngine() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'lib', 'match-engine.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
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

(async () => {
  const N = parseInt(process.argv[2] || '120', 10);
  const CATS = '动漫,短剧,剧集,电影,原盘,纪录片,综艺,演唱会,系列电影,连载,少儿频道,REMUX';
  const worker = require(path.join(__dirname, 'rematch-worker.cjs'));
  worker.setRps(10);
  worker.clearCache();
  const engine = loadEngine();

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
    `echo "${b64}" | base64 -d > /tmp/_ab.sql`,
    `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 -t -A -f /dev/stdin < /tmp/_ab.sql" 2>&1`,
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
  console.log(`同口径样本 ${sample.length} 条 (影视类 NOMATCH)\n`);

  let wHit = 0, eHit = 0, both = 0, onlyW = 0, onlyE = 0, neither = 0, wDiff = 0;
  const wHits = [], eHits = [];
  for (const r of sample) {
    const w = await worker.matchOne(r.name, r.category, r.sub_type || null);
    let e = null;
    try { e = await engine.matchOne(r.name, r.category, r.sub_type || null); } catch { }
    const eOk = e && typeof e === 'object' && e.id;
    if (w) { wHit++; wHits.push({ n: r.name, w }); }
    if (eOk) { eHit++; eHits.push({ n: r.name, e }); }
    if (w && eOk) { both++; if (w.id !== e.id) wDiff++; }
    else if (w) onlyW++;
    else if (eOk) onlyE++;
    else neither++;
  }
  console.log('=== 命中率对比 (同一样本) ===');
  console.log(`  worker: ${wHit}/${sample.length} = ${(100 * wHit / sample.length).toFixed(1)}%`);
  console.log(`  engine: ${eHit}/${sample.length} = ${(100 * eHit / sample.length).toFixed(1)}%`);
  console.log(`  都命中 ${both} | 仅worker ${onlyW} | 仅engine ${onlyE} | 都没中 ${neither}`);
  console.log(`  两者都命中但选的 id 不同: ${wDiff}`);
  console.log(`  API 调用 ${worker.getStats().apiCalls} 次`);
  console.log('\n=== engine 命中的样例 (人工看质量) ===');
  eHits.slice(0, 20).forEach(h => console.log(`  ${String(h.n).replace(/\n/g, ' ').slice(0, 46).padEnd(48)} → ${h.e.tmdb_type} ${h.e.id} 《${h.e.title}》`));
  console.log('\n=== worker 命中的样例 (人工看质量) ===');
  wHits.slice(0, 20).forEach(h => console.log(`  ${String(h.n).replace(/\n/g, ' ').slice(0, 46).padEnd(48)} → ${h.w.type} ${h.w.id} 《${h.w.title}》`));
})().catch(e => { console.error('FAIL', e); process.exit(1); });
