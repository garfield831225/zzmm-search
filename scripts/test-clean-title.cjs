// clean-title 提取器回归测试 (2026-10-29)
// 用实测踩到的坑样本 + 真实抽样验证
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
function req(name) {
  for (const p of [path.join(ROOT, 'node_modules', name), path.join('C:\\temp_zzmm', 'node_modules', name), name]) {
    try { return require(p); } catch { /* next */ }
  }
  throw new Error('找不到模块 ' + name);
}
const esbuild = req('esbuild');
function loadClean() {
  const out = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'src', 'lib', 'clean-title.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node18',
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}
const { cleanFolderName } = loadClean();

// [原名, 期望片名] —— 期望为 null 表示只检查「不含题材词」
const CASES = [
  ['镖人 第二季 (2026)动作 动画 武侠', '镖人'],
  ['将夜 (2026)动画', '将夜'],
  ['逆天邪神 年番(2026)', '逆天邪神'],
  ['凡人修仙传 年番4 (2026) [WEB', '凡人修仙传'],
  ['问心2 (2026) 更至32集 [', '问心2'],
  ['问心2 (2026)  WEB', '问心2'],
  ['金特务：本色回归 (2026)【更03集】【NF.', '金特务：本色回归'],
  ['九重紫 (2024)  爱情 古装   孟子义 李昀锐', '九重紫'],
  ['福尔摩斯小姐：马耳他谜局/福尔摩斯小姐3(2026)【', null],
  ['艾丽 /律政俏佳人前传 第一季 (2026)', null],
  ['杀戮一代 Generation Kill全集.', '杀戮一代'],
  ['如来神掌 (1982) 1080P 国粤英多音轨 内封简繁英字幕', '如来神掌'],
  ['绿夜 (2023) 1080p WEB-DL 中文字幕', '绿夜'],
  ['最大的小小农场 (2018) 1080P 外挂简英双语字幕', '最大的小小农场'],
  ['爱情公寓 第一季 1080P', '爱情公寓'],
  ['中国合伙人 4K HDR', '中国合伙人'],
  ['音乐之声 1965', null],
  ['龙之家族 第三季 1080P', '龙之家族'],
  ['短剧-重生之我在都市当首富 80集', null],
  ['【幻月字幕组】反正你也逃不掉【EP06】【1080P】【中日双语】', null],
  ['GM-Team  国漫  遮天  Shrouding the Heavens  20  1080p', '遮天'],
  ['【上好课】2027年高考《一轮时文阅读》热点聚焦高分突破(英语)(通用)', null],
  ['种墨园(2026)【更10集】【', '种墨园'],
  // 2026-10-29 新增: 字幕组后缀 (GROUP_SUFFIX_RE 从没被调用过) + 方括号发布组标签
  ['诸神字幕组  文豪野犬(四期)  Bungo Stray Dogs S4  02  1080p', '文豪野犬'],
  ['星空字幕组  魔法使的新娘2 / Mahoutsukai no Yome S2  0', '魔法使的新娘2'],
  ['【EMe】 龙与魔女  Burn the Witch  バーン・ザ・ウィッチ  01', null],
  ['【NC-Raws】  自称贤者弟子的贤者 / Kenja no Deshi  05', '自称贤者弟子的贤者'],
  ['酷漫404  鬼灭之刃  游郭篇  05  1080P', '鬼灭之刃'],
];

let pass = 0, fail = 0;
for (const [raw, want] of CASES) {
  const r = cleanFolderName(raw);
  const ok = want === null ? (r.cleanName.length >= 2 && !/动画|动作|武侠|古装|爱情|科幻/.test(r.cleanName)) : (r.cleanName === want);
  if (ok) pass++; else fail++;
  console.log(`${ok ? '✅' : '❌'} ${raw.slice(0, 48).padEnd(50)} → "${r.cleanName}"${want && r.cleanName !== want ? `  期望 "${want}"` : ''}  alts=${JSON.stringify(r.alts)}`);
}
console.log(`\n通过 ${pass} / ${CASES.length}  失败 ${fail}`);
