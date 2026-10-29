// rematch-worker 匹配质量验证 (2026-10-29)
// 从 NAS 拉真实 NOMATCH 样本 → 用 worker 的 matchOne 跑 → 出命中率 / tier 分布 / API 调用数
//
// 用法: node scripts/test-worker-match.cjs [--n 200] [--cats 电影,动漫] [--rps 10]
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

const ARGS = process.argv.slice(2);
const arg = (k, d) => { const i = ARGS.indexOf(k); return i >= 0 ? ARGS[i + 1] : d; };
const N = parseInt(arg('--n', '200'), 10);
const CATS = (arg('--cats', '动漫,短剧,剧集,电影,原盘,纪录片,综艺,演唱会,系列电影,连载,少儿频道,REMUX') || '').split(',').map(s => s.trim()).filter(Boolean);
const RPS = parseFloat(arg('--rps', '10'));
const SAVE = arg('--save', '');

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

(async () => {
  const worker = require(path.join(__dirname, 'rematch-worker.cjs'));
  worker.setRps(RPS);
  worker.clearCache();

  const conn = new Client();
  await new Promise((res, rej) => {
    conn.on('ready', res); conn.on('error', rej);
    conn.connect({
      host: NAS.host, port: NAS.port, username: NAS.user, password: NAS.pass, readyTimeout: 30000,
      algorithms: { kex: ['curve25519-sha256', 'diffie-hellman-group14-sha1'] },
    });
  });

  // 拉真实样本 (在 SQL 侧均匀抽样, 避免把 32 万行全拖过 SSH — 那会卡死)
  const catFilter = CATS.length ? `AND category IN (${CATS.map(c => `'${c.replace(/'/g, "''")}'`).join(',')})` : '';
  const sql = `SELECT row_to_json(t)::text FROM (
    SELECT id, name, category, COALESCE(sub_type,'') AS sub_type
    FROM xx_resources
    WHERE status='active' AND tmdb_id='NOMATCH' ${catFilter}
      AND id % 613 = 0
    ORDER BY id
  ) t LIMIT ${Math.max(N * 3, 400)}`;
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  // ⚠️ 必须 base64 → 文件 → -f /dev/stdin (shell 会吃掉 SQL 里的单引号)
  const pull = await sshRun(conn, [
    `echo "${b64}" | base64 -d > /tmp/_t.sql`,
    `echo "${NAS.pass}" | sudo -S -p "" bash -c "docker exec -i postgresql psql -U hyperms -d zzmm_search -v ON_ERROR_STOP=1 -t -A -f /dev/stdin < /tmp/_t.sql" 2>&1`,
  ].join('\n'));

  const rows = [];
  for (const ln of pull.stdout.split('\n')) {
    const s = ln.trim();
    if (!s.startsWith('{')) continue;
    try { rows.push(JSON.parse(s)); } catch { /* skip */ }
  }
  conn.end();
  console.log(`拉到 NOMATCH 样本 ${rows.length} 条`);

  // 均匀抽样 N 条 (覆盖全 id 区间)
  const step = Math.max(1, Math.floor(rows.length / N));
  const sample = [];
  for (let i = 0; i < rows.length && sample.length < N; i += step) sample.push(rows[i]);
  console.log(`均匀抽样 ${sample.length} 条开始匹配 (rps=${RPS})\n`);

  const t0 = Date.now();
  const tierCount = { exact: 0, prefix: 0, substr: 0, bigram: 0, fuzzy: 0 };
  const hits = [];
  let skipped = 0, failed = 0;
  const CONC = 8;
  for (let i = 0; i < sample.length; i += CONC) {
    const slice = sample.slice(i, i + CONC);
    const out = await Promise.all(slice.map(async r => {
      try { return { r, m: await worker.matchOne(r.name, r.category, r.sub_type || null) }; }
      catch { return { r, m: null }; }
    }));
    for (const o of out) {
      if (o.m) { tierCount[o.m.tier] = (tierCount[o.m.tier] || 0) + 1; hits.push(o); }
      else if (worker.typesFor(o.r.category, o.r.sub_type || null, null) === null) skipped++;
      else failed++;
    }
    process.stdout.write(`\r  ${Math.min(i + CONC, sample.length)}/${sample.length}  命中 ${hits.length} 跳过 ${skipped} 未匹配 ${failed}   `);
  }
  const el = (Date.now() - t0) / 1000;
  const st = worker.getStats();

  const highConf = tierCount.exact + tierCount.prefix + tierCount.substr;
  console.log(`\n\n=== 结果 ===`);
  console.log(`  样本 ${sample.length} | 耗时 ${el.toFixed(1)}s | API 调用 ${st.apiCalls} 次 (${(st.apiCalls / Math.max(1, sample.length)).toFixed(2)} 次/条)`);
  console.log(`  总命中 ${hits.length} (${(100 * hits.length / sample.length).toFixed(1)}%)`);
  console.log(`  高置信(exact+prefix+substr) ${highConf} (${(100 * highConf / sample.length).toFixed(1)}%) ← 只有这些会写库`);
  console.log(`  模糊(bigram+fuzzy) ${tierCount.bigram + tierCount.fuzzy}`);
  console.log(`  跳过(非影视分类) ${skipped} | 未匹配 ${failed}`);
  console.log(`  tier 分布: ${JSON.stringify(tierCount)}`);
  console.log(`  吞吐: ${(sample.length / el).toFixed(1)} 条/秒`);

  console.log(`\n命中样例 (前 25 条):`);
  hits.slice(0, 25).forEach(h => {
    console.log(`  [${h.m.tier}] ${String(h.r.name).replace(/\n/g, ' ').slice(0, 42).padEnd(42)} → ${h.m.type} ${h.m.id} 《${h.m.title}》${h.m.titleZh ? ' / ' + h.m.titleZh : ''}`);
  });

  if (SAVE) {
    const out = hits.map(h => ({
      id: h.r.id, name: h.r.name, category: h.r.category, tier: h.m.tier,
      tmdbId: h.m.id, type: h.m.type, title: h.m.title, titleZh: h.m.titleZh,
      poster: h.m.poster, ry: h.m.ry, usedName: h.m.usedName,
    }));
    fs.writeFileSync(SAVE, JSON.stringify(out, null, 2), 'utf8');
    console.log(`\n命中明细已存 ${SAVE}`);
  }
})().catch(e => { console.error('FAIL', e); process.exit(1); });
