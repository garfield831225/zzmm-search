// 把 src/lib/clean-title.ts 打成独立 bundle 给 NAS 上的 rematch-worker 用
// NAS 上没装 esbuild / 也没装项目依赖, 所以 bundle 完再传过去
//
// 用法: node scripts/build-rematch-worker.cjs
const path = require('node:path');
const fs = require('node:fs');
const ROOT = path.resolve(__dirname, '..');

function req(name) {
  for (const p of [path.join(ROOT, 'node_modules', name), path.join('C:\\temp_zzmm', 'node_modules', name), name]) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error('找不到模块 ' + name);
}
const esbuild = req('esbuild');

const out = path.join(__dirname, 'rematch-worker.clean-title.cjs');
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src', 'lib', 'clean-title.ts')],
  bundle: true,
  outfile: out,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
});

// 自检: bundle 必须能导出 cleanFolderName
const mod = require(out);
if (typeof mod.cleanFolderName !== 'function') {
  console.error('❌ bundle 没导出 cleanFolderName');
  process.exit(1);
}
const probe = mod.cleanFolderName('如来神掌 (1982) 1080P 国粤英多音轨 内封简繁英字幕');
console.log('OK ->', out, fs.statSync(out).size, 'bytes');
console.log('自检: cleanFolderName =>', JSON.stringify(probe));
