// 诊断 worker 匹配 miss 的真实原因 (2026-10-29)
// 对每条样本打印: 原名 → 清洗出的片名 → 年/季 → 类型 → TMDB 前 8 个候选 → 我们选了谁
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

(async () => {
  const worker = require(path.join(__dirname, 'rematch-worker.cjs'));
  worker.setRps(6);

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res); conn.on('error', rej);
    conn.connect({ host: NAS.host, port: NAS.port, username: NAS.user, password: NAS.pass, readyTimeout: 30000,
      algorithms: { kex: ['curve25519-sha256', 'diffie-hellman-group14-sha1'] } });
  });
  const N = parseInt(process.argv[2] || '12', 10);
  const sql = `SELECT row_to_json(t)::text FROM (
    SELECT id, name, category, COALESCE(sub_type,'') AS sub_type
    FROM xx_resources
    WHERE status='active' AND tmdb_id='NOMATCH' AND id % 613 = 0
    ORDER BY id
  ) t LIMIT ${N * 3}`;
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

  console.log(`样本 ${sample.length} 条\n`);
  for (const r of sample) {
    const c = worker.cleanFolderName(r.name);
    const types = worker.typesFor(r.category, r.sub_type || null, c.season);
    console.log('─'.repeat(100));
    console.log(`原名   : ${String(r.name).replace(/\n/g, ' ').slice(0, 90)}`);
    console.log(`分类   : ${r.category} / ${r.sub_type || '-'}`);
    console.log(`清洗   : clean="${c.cleanName}" year=${c.year || '-'} season=${c.season ?? '-'} alts=${JSON.stringify(c.alts)}`);
    console.log(`类型   : ${JSON.stringify(types)}`);
    if (!types) { console.log('跳过 (不该匹配 TMDB)'); continue; }
    for (const nm of [c.cleanName, ...(c.alts || [])].slice(0, 2)) {
      for (const type of types) {
        const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(nm)}&api_key=${TMDB_KEYS[0]}&language=zh-CN&page=1&include_adult=false`;
        let d = null;
        try { d = await (await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) })).json(); } catch (e) { }
        const res = (d && d.results ? d.results : []).slice(0, 8);
        console.log(`  查询[${type}] "${nm}" → ${res.length} 条候选`);
        res.forEach(x => {
          const zh = x.title || x.name || '';
          const en = x.original_title || x.original_name || '';
          const ry = (x.release_date || x.first_air_date || '').slice(0, 4);
          console.log(`      ${String(x.id).padStart(7)}  ${zh.padEnd(34)} ${String(en).padEnd(30)} ${ry}  ★${x.vote_average || 0}`);
        });
        if (!res.length) {
          const url2 = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(nm)}&api_key=${TMDB_KEYS[0]}&language=en-US&page=1&include_adult=false`;
          try { d = await (await fetch(url2, { cache: 'no-store', signal: AbortSignal.timeout(20000) })).json(); } catch (e) { }
          const res2 = (d && d.results ? d.results : []).slice(0, 5);
          console.log(`      (en-US 重查) ${res2.length} 条`);
          res2.forEach(x => console.log(`      ${String(x.id).padStart(7)}  ${(x.title || x.name || '').padEnd(34)} ${(x.original_title || x.original_name || '').padEnd(30)} ${(x.release_date || x.first_air_date || '').slice(0, 4)}`));
        }
      }
    }
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
