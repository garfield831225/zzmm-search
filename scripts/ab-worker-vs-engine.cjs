// 同样本 A/B: worker 版 vs engine 版 匹配命中率对比 (2026-10-29)
const path = require('node:path');
const fs = require('node:fs');
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

// bundle match-engine.ts
function loadEngine() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'lib', 'match-engine.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const N = parseInt(process.argv[2] || '60', 10);
  const CATS = '动漫,短剧,剧集,电影,原盘,纪录片,综艺,演唱会,系列电影';
  const worker = require(path.join(__dirname, 'rematch-worker.cjs'));
  worker.setRps(8);
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
    `echo "${b64}" | base64 -d > /tmp/_d.sql`,
    `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 -t -A -f /dev/stdin < /tmp/_d.sql" 2>&1`,
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
  console.log(`影视类样本 ${sample.length} 条 (来自 ${rows.length} 条候选)\n`);

  let wHit = 0, eHit = 0, both = 0, onlyW = 0, onlyE = 0, neither = 0;
  const diffs = [];
  for (const r of sample) {
    const w = await worker.matchOne(r.name, r.category, r.sub_type || null);
    const e = await engine.matchOne(r.name, r.category, r.sub_type || null);
    const eOk = e && typeof e === 'object' && e.id;
    if (w) wHit++; if (eOk) eHit++;
    if (w && eOk) { both++; if (w.id !== e.id) diffs.push({ r, w, e, why: 'id不同' }); }
    else if (w) { onlyW++; diffs.push({ r, w, e, why: '仅worker命中' }); }
    else if (eOk) { onlyE++; diffs.push({ r, w, e, why: '仅engine命中' }); }
    else neither++;
  }
  console.log(`=== 命中对比 ===`);
  console.log(`  worker 命中 ${wHit}/${sample.length} (${(100 * wHit / sample.length).toFixed(1)}%)`);
  console.log(`  engine 命中 ${eHit}/${sample.length} (${(100 * eHit / sample.length).toFixed(1)}%)`);
  console.log(`  都命中 ${both} | 仅worker ${onlyW} | 仅engine ${onlyE} | 都没中 ${neither}`);
  console.log(`  API 调用 ${worker.getStats().apiCalls} 次`);

  console.log(`\n=== 差异明细 (前 25) ===`);
  diffs.slice(0, 25).forEach(d => {
    const c = worker.cleanFolderName(d.r.name);
    console.log(`  [${d.why}] ${String(d.r.name).replace(/\n/g, ' ').slice(0, 52)}`);
    console.log(`      清洗: "${c.cleanName}" year=${c.year || '-'} alts=${JSON.stringify(c.alts)}`);
    console.log(`      worker: ${d.w ? `[${d.w.tier}] ${d.w.type} ${d.w.id} 《${d.w.title}》` : 'MISS'}`);
    console.log(`      engine: ${d.e && d.e.id ? `${d.e.tmdb_type} ${d.e.id} 《${d.e.title}》` : JSON.stringify(d.e)}`);
  });
})().catch(e => { console.error('FAIL', e); process.exit(1); });
