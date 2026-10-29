// 2026-10-29: 片名提取重写 (独立模块, 便于单测)
//   原 match-engine.ts 的 cleanFolderName 有 7 个实测出来的缺陷 (用 8864 条真实样本跑出来的):
//   1) F 分支「最长中文片段」被画质/字幕描述词劫持
//      「如来神掌 (1982) 1080P 国粤英多音轨 内封简繁英字幕」→ 提成「内封简繁英字幕」
//      「绿夜 (2023) 1080p WEB-DL 中文字幕」→ 提成「中文字幕」
//      「最大的小小农场 (2018) 1080P 外挂简英双语字幕」→ 提成「外挂简英双语字幕」
//   2) 规格 token 只认 WEB-DL, 不认 WEB-4K / WEB-1080p → 残留「WEB-」
//   3) HDR10 被短规则「HDR」抢先 → 残留「10」
//   4) 集数标记 (【01】/EP02/34-38) 没剥
//   5) 发布组/字幕组前缀 (【幻月字幕组】/桜都字幕組/GM-Team) 没剥
//   6) 双语片名「葬送的芙莉莲 第二季 / Sousou no Frieren」没拆
//   7) 短剧前缀「短剧-」+ 演员名没剥
//
//   修法: ①长词优先的噪音表 ②规格 token 通用化 ③集数/发布组剥离
//         ④F 分支排除噪音片段 ⑤返回多候选 alts (匹配层依次尝试, 提升召回)

export interface CleanResult {
  cleanName: string;
  year: string;
  season: number | null;
  alts: string[];   // 备选片名, 按可信度降序
}

// ─── 英文/数字规格 token (\b 边界) ─────────────────────────────────────
// ⚠️ 顺序即优先级: 长词必须在前 (正则 alternation 从左到右匹配)
//   HDR10 必须在 HDR 前, WEB-DL 必须在 WEB 前
const SPEC_RE = new RegExp(
  '\\b(?:' + [
    'Dolby\\s*Vision', 'Dolby\\s*Atmos', 'Dolby',
    'HDR10\\+', 'HDR10', 'HDR', 'SDR',
    'DTS-?HD', 'DTS-?X', 'DTS', 'TrueHD', 'Atmos', 'AC-?3', 'AAC2?\\.?0', 'AAC', 'LPCM', 'FLAC', 'DDP',
    'WEB-?DL', 'WEBRip', 'WEBDL', 'Blu-?ray', 'BDRip', 'BDMV', 'REMUX',
    'WEB', 'HDTV', 'HD-?DVD', 'DVDRip', 'HDRip', 'VCD', 'SVCD', 'DVD', 'Rip',
    '10\\s*bit', '8\\s*bit', 'Hi10p?', 'H\\.?264', 'H\\.?265', 'x\\.?264', 'x\\.?265', 'AVC', 'HEVC',
    '8K', '4K', '2160p', '1080p', '720p', '480p', '360p', 'UHD',
    '2160', '1080', '720', '480', '360', '576p',
    '\\d{2,3}\\s*FPS', 'FPS',
    'DV', 'IMAX', 'MAX', 'TV',
    'Netflix', 'NF', 'Hulu', 'HBO', 'AMC', 'DDP', 'AMZN',
  ].join('|') + ')\\b',
  'gi'
);

// ─── 题材/类型词 (2026-10-29 实测补) ─────────────────────────────────────
// ⚠️ 必须是「独立 token」才剥 (前后都是分隔符或首尾)
//   否则会误伤片名: 「爱情公寓」「中国合伙人」「音乐之声」「历史的车轮」
//   实测样本: 「镖人 第二季 (2026)动作 动画 武侠」→ 原来提成「镖人 动作 动画 武侠」
//   「将夜 (2026)动画」→ 提成「将夜 动画」→ TMDB 搜不到, 退化成拿「动画」去搜
//   → 匹配到《清华附小语文综合动画课》这种垃圾 (engine 旧版 58.5% 里混了很多这种假阳性)
const SEP_CLASS = '[^\\s\\-_/｜|（）()【】\\[\\]，,。·、]';
const GENRE_WORDS = [
  // 类型
  '动作片', '喜剧片', '恐怖片', '科幻片', '悬疑片', '惊悚片', '犯罪片', '剧情片', '爱情片', '文艺片', '纪录片',
  '古装剧', '悬疑剧', '科幻剧', '喜剧剧', '恐怖剧', '犯罪剧', '动作剧', '剧情剧', '偶像剧',
  '动作', '动画', '武侠', '古装', '爱情', '悬疑', '科幻', '喜剧', '恐怖', '犯罪', '战争', '奇幻', '玄幻',
  '仙侠', '都市', '校园', '职场', '剧情', '纪录片', '综艺', '军事', '历史', '传记', '现实', '冒险',
  '惊悚', '灾难', '儿童', '少儿', '短片', '运动', '体育', '歌舞', '家庭', '成长', '青春', '悬疑推理',
  // 地区/语言
  '国语', '粤语', '英语', '日语', '韩语', '泰语', '欧美', '日韩', '港台', '大陆', '内地',
  '港版', '台版', '国版', '美版', '日版', '韩版', '中国', '香港', '台湾', '日本', '韩国', '美国', '英国', '法国',
  // 画质/来源/版本
  '蓝光', '原盘', '高清', '超清', '抢先', '定档', '上映', '独家', '会员', '付费', '未删减', '数字版',
  '导演剪辑', '加长', '重制', '修复', '蓝光修复', '内嵌', '外挂',
  // 动画连载形态
  '年番', '季番', '半年番', '周更', '日更', '月更', '年更',
  '国漫', '日漫', '美漫', '番剧', '动漫', '剧场版', '总集篇',
];
const GENRE_TOKEN_RE = new RegExp(
  '(?<!' + SEP_CLASS + ')(?:' + GENRE_WORDS.join('|') + ')(?!' + SEP_CLASS + ')',
  'g'
);

// ─── 中文噪音词 (要求前面是分隔符或行首, 否则会误伤片名) ──────────────
// ⚠️ 顺序即优先级: 长词在前 (内封简繁英字幕 必须在 内封 前)
const CN_NOISE_RE = new RegExp(
  '(?<![^\\s\\-_/｜|（）()【】\\[\\]，,。·、])' + [
    '内封简繁英字幕', '内封简繁字幕', '内嵌简中', '外挂简英双语字幕', '外挂字幕', '外挂中字',
    '简繁英字幕', '中文字幕', '英文字幕', '简体字幕', '繁体字幕', '简繁字幕', '简繁内封', '双语字幕',
    '国粤英多音轨', '国粤双语', '国英双语', '国粤配音', '国语配音', '粤语配音', '日语配音', '英语配音',
    '多音轨', '双音轨', '音轨', '配音', '国配', '粤语', '国语', '特效字幕', '特效',
    '高码率', '高码', '中码', '码率', '臻彩', '超清', '未删减', '完整版', '高清', '帧绮映画', '高帧率', '帧率',
    '导演剪辑版', '加长版', '终极版', '特别版', '抢先版', '正式版', '重制版', '修复版', '4K修复',
    '杜比视界', '杜比音效', '杜比', '视界', '音效',
    '无台标', '内嵌', '外挂', '内封', '版本',
    '字幕组', '字幕組', '压制组', '发布组', '翻译组',
    '中字', '简繁', '双语', '字幕',
    '完结', '更新中', '连载中',
  ].join('|'),
  'g'
);

// ─── 集数标记 ───────────────────────────────────────────────────────────
// 【01】[02] / EP02 / E12 / 34-38 / 第03集 / 更新至12集 / 全32集 / 05 /
const EPISODE_RE = new RegExp(
  '\\s*(?:' + [
    '[【\\[（(]\\s*(?:0?[1-9]|[12]\\d|3\\d)\\s*[】\\]）)]',   // 【01】 [02]
    'EP\\d{1,3}', 'E\\d{1,3}\\b', 'EPISODE\\s*\\d{1,3}',
    '第\\s*\\d{1,4}\\s*集', '更新至\\s*\\d{1,4}\\s*集', '全\\s*\\d{1,4}\\s*集', '\\d{1,4}\\s*集\\s*全',
    '更至\\s*\\d{1,4}\\s*集', '更\\s*\\d{1,4}\\s*集', '共\\s*\\d{1,4}\\s*集', '全\\s*\\d{1,4}\\s*集',
    '\\d{1,3}\\s*[-~]\\s*\\d{1,3}(?!\\s*[-~])',            // 34-38
    '(?<![\\d])\\d{1,3}\\s*集',
  ].join('|') + ')\\s*',
  'gi'
);

// ─── 季度标记 ───────────────────────────────────────────────────────────
const SEASON_RE = /第[一二三四五六七八九十\d]+季|S\d{1,2}(?![集\d])|Season\s*\d{1,2}|第[一二三四五六七八九十\d]+期|[一二三四五六七八九十\d]+期(?![集期])/gi;

// ─── 发布组/字幕组前缀 ──────────────────────────────────────────────────
// 【幻月字幕组】【喵萌奶茶屋】/ 桜都字幕組  / GM-Team  / ANi  / MingY
const BRACKET_GROUP_RE = /[【\[]\s*(?:[^\]】]{0,18}?(?:字幕[组組]|压制组|发布组|翻译组|工作室))\s*[】\]]\s*/g;
// 行首拉丁发布组 (后面必须跟中文, 避免误伤纯英文片名)
const LEADING_GROUP_RE = /^[A-Za-z0-9][A-Za-z0-9&._\-]{1,18}[\s\-]+(?=[\u4e00-\u9fff])/;
// 字幕组后缀形态 (行尾/中段)
const GROUP_SUFFIX_RE = /[\s\-]*[\u4e00-\u9fff]{0,3}字幕[组組]\s*/g;

// ─── 短剧前缀 ───────────────────────────────────────────────────────────
const SHORTDRAMA_PREFIX_RE = /^\s*(?:短剧|微短剧|竖屏短剧|横屏短剧)\s*[-—–:：\s]*|[【\[]\s*短剧\s*[】\]]\s*/g;

// ─── 尾部管道 (TG 消息常见: "| 夸克" / "| 百度网盘") ────────────────────
const PIPE_TAIL_RE = /\s*[|｜]\s*(?:夸克|百度|阿里|天翼|迅雷|115|UC|123|迅雷云盘|百度网盘|夸克网盘|阿里云盘)\s*$/;

// ─── 短剧演员尾 ( "(63集) 张锦亮&路露") ─────────────────────────────────
const ACTOR_TAIL_RE = /\s*[（(]?\s*\d{1,4}\s*集?\s*[）)]?\s*[\u4e00-\u9fff]{2,4}\s*[&＆·]\s*[\u4e00-\u9fff]{2,4}(?:\s*[&＆·]\s*[\u4e00-\u9fff]{2,4})*\s*$/;

function isNoiseOnly(s: string): boolean {
  if (!s) return true;
  const t = s.trim();
  if (t.length < 2) return true;
  // 纯数字/符号
  if (!/[\u4e00-\u9fffA-Za-z]/.test(t)) return true;
  // 命中噪音词
  if (SPEC_RE.test(t)) { SPEC_RE.lastIndex = 0; return true; }
  if (CN_NOISE_RE.test(t)) { CN_NOISE_RE.lastIndex = 0; return true; }
  // 2026-10-29: 纯题材/类型词也算噪音 ("动画"/"动作"/"武侠" 不能当片名)
  if (GENRE_TOKEN_RE.test(t)) { GENRE_TOKEN_RE.lastIndex = 0; return true; }
  // 以描述词开头
  if (/^(?:国语|英语|粤语|日语|中文|字幕|内封|外挂|简繁|双语|特效|高码|码率|无台标|臻彩|完结|更新中|片源|版本)/.test(t)) return true;
  // 集数/季数字
  if (/^[\d\s\-~第集季完更新全片源版本]+$/.test(t)) return true;
  return false;
}

function pushAlt(list: string[], s: string | undefined | null) {
  if (!s) return;
  const t = s.trim().replace(/^[\s\-_.·、,，]+|[\s\-_.·、,，]+$/g, '').replace(/\s{2,}/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 60) return;
  if (list.includes(t)) return;
  list.push(t);
}

function chineseToNumber(str: string): number {
  const map: Record<string, number> = {
    '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
    '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
  };
  if (/^\d+$/.test(str)) return parseInt(str);
  if (map[str] !== undefined) return map[str];
  if (str.startsWith('十')) return 10 + (map[str[1]] || 0);
  if (str.includes('十')) return (map[str[0]] || 0) * 10 + (map[str[2]] || 0);
  return 1;
}

/**
 * 提取片名 (2026-10-29 重写)
 */
export function cleanFolderName(raw: string): CleanResult {
  const alts: string[] = [];
  if (!raw || !raw.trim()) {
    return { cleanName: '', year: '', season: null, alts };
  }

  // ── Step 0: 基础预处理 ──
  let s = String(raw).replace(/\r/g, '\n');
  // TG 消息常是「片名 (集数) 演员 | 夸克」多行结构 → 取第一行, 去掉尾部管道
  const firstLine = s.split('\n').map((x) => x.trim()).find((x) => x.length > 0) || '';
  if (firstLine) s = firstLine;
  s = s.replace(PIPE_TAIL_RE, '').trim();

  // ── Step 1: 年份 (在清洗前后都看一眼) ──
  let year = '';
  const yearMatch = s.match(/(?:^|[^\d])(19\d{2}|20\d{2})(?![\d])/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y >= 1900 && y <= 2030) year = String(y);
  }

  // ── Step 2: 季 ──
  let season: number | null = null;
  const seasonMatch = s.match(/第([一二三四五六七八九十\d]+)季(?!集)|S(\d{1,2})(?![集\d])/i);
  if (seasonMatch) {
    season = seasonMatch[1] ? chineseToNumber(seasonMatch[1]) : parseInt(seasonMatch[2]);
  }

  // ── Step 3: 剥发布组前缀 + 短剧前缀 ──
  s = s.replace(BRACKET_GROUP_RE, '');
  s = s.replace(LEADING_GROUP_RE, '');
  s = s.replace(SHORTDRAMA_PREFIX_RE, '');
  // ⚠️ 2026-10-29 修: GROUP_SUFFIX_RE 定义了却从来没被调用!
  //   后果: 「诸神字幕组 文豪野犬」→「诸神文豪野犬」→ cleanName 提成「诸神」
  //        → 匹配到《诸神末日》这种垃圾 (实测 25 条命中里错了 3 条都是这个原因)
  s = s.replace(GROUP_SUFFIX_RE, ' ');
  // ⚠️ 这里**不**剥所有方括号 —— 方括号里可能是片名本身 (【拳王】/《XX》)
  //   magnet 那种多段方括号 【字幕组】【番名】【集数】【画质】 靠候选阶段的优先级挑出番名
  //   (见下面 B 分支: 数字开头的降权, 再按长度降序)

  // ── Step 4: 剥集数 ──
  s = s.replace(EPISODE_RE, ' ');

  // ── Step 5: 剥噪音词 (先英文规格, 再中文噪音) ──
  // 2026-10-29: 先把连写的规格拆开, 否则 \b 边界不成立, 剥不掉
  //   "4KHDR" → "4K HDR" / "WEB-1080" → "WEB -1080" / "WEB-4K" → "WEB -4K"
  s = s.replace(/\b(4K|8K)(?=(HDR|DV|SDR|DL|WEB|X26|H26|HEVC|AVC))/gi, '$1 ');
  s = s.replace(/\bWEB(?=[\d])/gi, 'WEB ');
  // ⚠️ WEB-DL 不能拆! 拆了 "WEB-DL" → "WEB -DL" → 'WEB-?DL' 匹配不上 → 残留 "绿夜 -DL"
  s = s.replace(/\bWEB(?=-(?!DL\b))/gi, 'WEB ');
  s = s.replace(SPEC_RE, ' ');
  s = s.replace(CN_NOISE_RE, ' ');
  // 「全集/全片」不带分隔符也要剥 ("杀戮一代 Generation Kill全集." → "杀戮一代 Generation Kill")
  s = s.replace(/(?:全集|全片|全部集|完整版)/g, ' ');
  // 2026-10-29: 年番/季番 可带数字 ("凡人修仙传 年番4") → 先剥数字再剥词
  s = s.replace(/(?:年|季|半年)番\s*\d*/g, ' ');
  // 2026-10-29: 剥题材/类型词 (独立 token 才剥, 避免误伤「爱情公寓」「中国合伙人」)
  s = s.replace(GENRE_TOKEN_RE, ' ');

  // ── Step 6: 剥季 (季号对 TMDB 搜索是噪音) ──
  s = s.replace(SEASON_RE, ' ');

  // ── Step 7: 剥年份括号 (但保留 year 变量) ──
  s = s.replace(/[（(]\s*(?:19\d{2}|20\d{2})\s*[)）]/g, ' ');

  // ── Step 8: 剥短剧演员尾 ──
  s = s.replace(ACTOR_TAIL_RE, ' ');

  // ── Step 9: 清理符号残留 ──
  s = s.replace(/\s{2,}/g, ' ').trim();
  // 空括号 ("反正你也逃不掉【 】【 】" → 内容被剥完只剩空壳)
  s = s.replace(/【\s*】|\[\s*\]|（\s*）|\(\s*\)/g, ' ');
  s = s.replace(/^[\s\-_.·、,，:：|/\\]+/, '').replace(/[\s\-_.·、,，:：|/\\]+$/, '').trim();
  // 2026-10-29: 尾部残留的孤立括号也要剥 ("问心2 更至32集 [" → "问心2")
  s = s.replace(/[\s\-_.·、,，:：|/\\【】\[\]()（）]*$/, '').trim();
  s = s.replace(/\s*[-–—]\s*$/, '').trim();
  // 尾部独立集数 ("遮天 Shrouding the Heavens 20" → 去掉末尾的 20)
  s = s.replace(/\s+\d{1,4}\s*$/, ' ').trim();
  // 剥完留下的孤立大写/数字块 (如 "WEB"/"NF"/"HDR");
  // ⚠️ 只剥大写和数字 —— 2026-10-29 修了 "Shrouding the Heavens" 的 "the" 被误删
  s = s.replace(/(?:^|\s)[A-Z0-9]{1,4}(?=\s|$)/g, (m) => (m.startsWith(' ') || m.startsWith('\t') ? ' ' : ''));

  // ══════════════════════════════════════════════════════════════════════
  // 取片名: 多分支 + 候选
  // ══════════════════════════════════════════════════════════════════════
  const cand: string[] = [];

  // A: ISO 文件名 → 第一个方括号
  if (raw.trim().endsWith('.iso')) {
    const brackets = Array.from(raw.matchAll(/\[([^\]]+)\]/g)).map((m) => m[1]);
    for (const b of brackets) {
      const t = b.replace(/\s*\d{4}(?=\W|$)/, '').replace(/^\s*(?:4K|8K|2160p|1080p|720P|DIY|CEE|美版|日版|港版|欧版|韩版|台版|DV|HDR|Dolby|Atmos|DTS|HEVC|LPCM)\s*/i, '').trim();
      if (t.length >= 2 && /[\u4e00-\u9fffA-Za-z]/.test(t)) { pushAlt(cand, t); break; }
    }
  }

  // B: 多段方括号 / 书名号 (【拳王】/《XX》) —— 优先于点分隔
  //    多个方括号时: 「数字开头」的降权 (【22年日剧】不算片名), 其次按长度降序
  //    例 【幻月字幕组】【22年日剧】【浪漫暴风圈】【01】→ 选「浪漫暴风圈」
  const bracketInner = Array.from(s.matchAll(/[【\[《]([^】\]》]{2,30})[】\]》]/g)).map((m) => m[1].trim());
  // ⚠️ 2026-10-29: 方括号里可能是发布组/版本标签 ("【EMe】" "【NC-Raws】")
  //   → 只认「含中文」或「≥5 字符」的方括号内容, 否则会提成 "EMe" 这种垃圾片名
  const bracketGood = bracketInner.filter((b) =>
    !isNoiseOnly(b) && (b.length >= 5 || /[\u4e00-\u9fff]/.test(b)));
  bracketGood.sort((a, b) => {
    const na = /^\d/.test(a) ? 1 : 0, nb = /^\d/.test(b) ? 1 : 0;
    if (na !== nb) return na - nb;
    return b.length - a.length;
  });
  for (const b of bracketGood) pushAlt(cand, b);

  // C: 点分隔 (片名.年份 / 片名.规格) —— 年份段跳过
  //    ⚠️ 2026-10-29: 必须要求「原串含点」且「该段不含空格」
  //       否则整串没点号时会被整段当成片名 ("九重紫 孟子义 李昀锐" → 提成整串)
  if (s.includes('.')) {
    const dotParts = s.split('.').map((x) => x.trim()).filter(Boolean);
    for (const p of dotParts) {
      if (/^(?:19|20)\d{2}$/.test(p)) continue;
      if (p.length >= 2 && p.length <= 24 && !/\s/.test(p) && /[\u4e00-\u9fff]/.test(p) && !isNoiseOnly(p)) { pushAlt(cand, p); break; }
      if (p.length >= 2 && p.length <= 12 && /[\u4e00-\u9fff]/.test(p) && !isNoiseOnly(p)) { pushAlt(cand, p); break; }
    }
  }

  // D: 斜杠分隔的双语片名 → 取第一段 (通常是主片名), 第二段做 alt
  //    ⚠️ 2026-10-29: 段内要先剥掉方括号组 ("【NC-Raws】 自称贤者弟子的贤者" → "自称贤者弟子的贤者")
  const stripBrackets = (x: string) => x.replace(/[【\[《][^】\]》]{0,30}[】\]》]\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const slashParts = s.split(/\s*\/\s*/).map((x) => stripBrackets(x)).filter(Boolean);
  if (slashParts.length >= 2) {
    for (const p of slashParts) {
      if (!isNoiseOnly(p) && /[\u4e00-\u9fffA-Za-z]/.test(p)) { pushAlt(cand, p); break; }
    }
    for (const p of slashParts) { if (!isNoiseOnly(p)) pushAlt(alts, p); }
  }

  // E: 中文片段 → **排除噪音片段** (这是旧版最大的坑)
  //    排序: 数字开头的降权, 再按长度降序
  //    ⚠️ 全角冒号「：」要留在片段里 —— 中文片名常用它做副标题分隔
  //       「金特务：本色回归」被拆成「金特务」+「本色回归」→ 提成错的名字
  const cnFrags = s.match(/[\u4e00-\u9fff][^\[\]（）【】《》\s,，。:/]{0,30}/g) || [];
  let goodFrags = cnFrags.map((x) => x.trim()).filter((x) => x.length >= 2 && !isNoiseOnly(x));
  // ⚠️ 2026-10-29: 含数字的片段降权 ("酷漫404 鬼灭之刃" → 原本提成 "酷漫404")
  //   「酷漫404」是字幕组名, 「鬼灭之刃」才是片名
  //   只在「存在不含数字的片段」时才降权, 避免误伤 "问心2" 这种真片名
  const noDigitFrags = goodFrags.filter((x) => !/\d/.test(x));
  if (noDigitFrags.length) goodFrags = noDigitFrags;
  goodFrags.sort((a, b) => {
    const na = /^\d/.test(a) ? 1 : 0, nb = /^\d/.test(b) ? 1 : 0;
    if (na !== nb) return na - nb;
    return b.length - a.length;
  });
  if (goodFrags.length) {
    // 最长的非噪音片段优先
    pushAlt(cand, goodFrags[0]);
    for (const g of goodFrags.slice(1)) pushAlt(alts, g);
  }

  // F: 括号内容 (剩余)
  const parenInner = Array.from(s.matchAll(/[（(]([^）)]{2,30})[）)]/g)).map((m) => m[1].trim());
  for (const p of parenInner) { if (!isNoiseOnly(p)) pushAlt(cand, p); }

  // G: 纯英文名
  const pureEn = s.replace(/[^\x20-\x7e]/g, '').replace(/\s{2,}/g, ' ').trim();
  if (pureEn.length >= 2 && /[A-Za-z]/.test(pureEn)) pushAlt(cand, pureEn);

  // H: 兜底 = 清洗后的整体
  if (s.length >= 2) pushAlt(cand, s);

  // 最终 cleanName: 第一个非噪音候选
  // ⚠️ 2026-10-29: 原串含中文时, 优先选「含中文」的候选
  //   「【EMe】龙与魔女 Burn the Witch」→ 候选里 "EMe" 排前面 → 提成 "EMe" 匹配到《Eme de Muna》
  const hasCjk = /[\u4e00-\u9fff]/.test(s);
  let cleanName = '';
  if (hasCjk) {
    for (const c of cand) { if (/[\u4e00-\u9fff]/.test(c) && !isNoiseOnly(c)) { cleanName = c; break; } }
  }
  if (!cleanName) {
    for (const c of cand) {
      if (!isNoiseOnly(c)) { cleanName = c; break; }
    }
  }
  if (!cleanName && cand.length) cleanName = cand[0];
  if (!cleanName) {
    // 全部候选都像噪音 → 退回清洗后的整体 (让上层报 NOMATCH 而不是错片名)
    cleanName = s.replace(/\s{2,}/g, ' ').trim();
  }

  // alts: 候选里除 cleanName 外的其它可信候选
  // 2026-10-29: alt 必须 ≥4 字 (2-3 字片段拿去搜 TMDB 极易匹配到别的作品:
  //   「动画」→《清华附小语文综合动画课》; 「神楽坂」→《神乐坂署生活安全课》)
  for (const c of cand) {
    if (c !== cleanName && c.length >= 4 && !isNoiseOnly(c)) pushAlt(alts, c);
  }

  return { cleanName, year, season, alts: alts.slice(0, 4) };
}
