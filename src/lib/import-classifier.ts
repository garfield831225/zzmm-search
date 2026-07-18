// 2026-07-16: 导入分类公共工具
// 用途: 标准 Excel / 快速导入 / TG JSON 导入 / tg-organize 共用
// 不动泽泽妈妈 21-sheet 导入 (那个用 ZZMM_SHEET_MAP)
// 2026-07-17: 1对N 改造, 加 9 个新 source + magnet 兜底 category + 优先级排序

export type ResourceSource = '115' | 'baidu' | 'quark' | 'aliyun' | 'xunlei' | '123' | 'uc' | 'tianyi' | 'yidong' | 'magnet' | 'ed2k' | 'telegra_ph' | 'other';
export type ResourceAccessLevel = 'basic' | 'vip' | 'code';
export type ResourcePayType = 'free' | 'code';
export type ImportChannel = 'zezemom_excel' | 'tg_baidu' | 'tg_quark' | 'tg_music' | 'other';

// ─── 全局写死 sort 优先级 (G5-a) ────────────────────────────────────────
// 打开组 (1-9) + 复制组 (10) — 所有资源统一按这个排
export const SOURCE_SORT: Record<string, number> = {
  '115': 1,
  'baidu': 2,
  'quark': 3,
  'aliyun': 4,
  'xunlei': 5,
  '123': 6,
  'uc': 7,
  'tianyi': 8,
  'yidong': 9,
  'magnet': 10,
  'ed2k': 10,  // 跟 magnet 同组, 复制按钮
  'telegra_ph': 99,  // 兜底, 不该入库
  'other': 99,
};

// 网盘类型 → 中文 label
export const SOURCE_LABELS: Record<string, { label: string; icon: string; action: 'open' | 'copy' }> = {
  '115': { label: '115 网盘', icon: '📦', action: 'open' },
  'baidu': { label: '百度网盘', icon: '🅱️', action: 'open' },
  'quark': { label: '夸克网盘', icon: '🍊', action: 'open' },
  'aliyun': { label: '阿里云盘', icon: '☁️', action: 'open' },
  'xunlei': { label: '迅雷', icon: '⚡', action: 'open' },
  '123': { label: '123 网盘', icon: '1️⃣', action: 'open' },
  'uc': { label: 'UC 网盘', icon: '🅿️', action: 'open' },
  'tianyi': { label: '天翼云盘', icon: '☂️', action: 'open' },
  'yidong': { label: '移动云盘', icon: '📱', action: 'open' },
  'magnet': { label: '磁力', icon: '🧲', action: 'copy' },
  'ed2k': { label: '磁力', icon: '🧲', action: 'copy' },
};

// ─── 关键词规则 (priority 高→低, 第一个命中用) ─────────────────────
interface KeywordRule {
  patterns: string[];        // 任一 pattern 命中即匹配
  category: string;          // 目标 category
  priority: number;          // 数字越大越优先
}

const KEYWORD_CATEGORY_RULES: KeywordRule[] = [
  // 电子书 / 有声 / 小说
  { patterns: ['有声', '小说', 'EPUB', 'MOBI', 'AZW3', 'TXT电子书', 'txt电子'], category: '电子书', priority: 100 },
  // 精品课
  { patterns: ['精品课', '课程', '讲座', '培训', '网课', '教学', '教程课'], category: '精品课', priority: 90 },
  // 文档 / 教辅 / 教材 / PDF
  { patterns: ['文档', '教程', '讲义', '课件', '教材', '学习资料', 'PDF', '教辅'], category: '文档', priority: 80 },
  // 音乐
  { patterns: ['FLAC', 'Hi-Res', 'HiRes', '专辑', 'SACD', 'DSD', 'HiFi', '演唱会', 'mp3下载', 'APE', 'WAV', '无损'], category: '音乐', priority: 70 },
  // 体育
  { patterns: ['NBA', '球赛', '欧冠', '世界杯', '英超', '西甲', '德甲', '意甲', '中超', 'CBA'], category: '体育', priority: 60 },
  // 剧集 (连续剧标志)
  { patterns: ['S0', 'E0', '连载', '更新至', '全', '第', '季'], category: '剧集', priority: 30 },
  // 综艺
  { patterns: ['综艺', '真人秀', '选秀'], category: '综艺', priority: 25 },
  // 纪录片
  { patterns: ['纪录片', '纪录', 'BBC', 'NHK'], category: '纪录片', priority: 20 },
  // 演唱会 (优先级比音乐低因为音乐 keyword 已经覆盖部分)
  { patterns: ['演唱会', 'live', 'LIVE', 'concert', 'Concert', '巡演', '音乐会'], category: '演唱会', priority: 65 },
];

// ─── 标准 category 列表 (匹配用, 不匹配则 fallback) ────────────────
export const STANDARD_CATEGORIES = [
  '电影', '剧集', '动漫', '纪录片', '综艺', '演唱会',
  '音乐', '体育', '少儿频道', '连载',
  '原盘', 'REMUX', '系列电影', '合集',
  '电子书', '精品课', '文档',
] as const;

// ─── 1. detectSource(link) ──────────────────────────────────────────
export function detectSource(link: string): ResourceSource {
  if (!link) return 'other';
  const l = link.toLowerCase();
  // 115 系列域名
  if (l.includes('115.com') || l.includes('115cdn.com') || l.includes('anxia.com') || l.includes('115cdn')) return '115';
  // 夸克
  if (l.includes('quark.cn') || l.includes('quark')) return 'quark';
  // 百度
  if (l.includes('baidu.com') || l.includes('yun.baidu') || l.includes('pan.baidu')) return 'baidu';
  // 阿里
  if (l.includes('aliyun.com') || l.includes('aliyundrive') || l.includes('alipan')) return 'aliyun';
  // 迅雷网盘
  if (l.includes('xunlei.com') || l.includes('pan.xunlei')) return 'xunlei';
  // 123 网盘
  if (l.includes('123pan.com') || l.includes('123685')) return '123';
  // UC 网盘
  if (l.includes('drive.uc.cn') || l.includes('uc.cn')) return 'uc';
  // 天翼云盘
  if (l.includes('cloud.189.cn') || l.includes('189.cn')) return 'tianyi';
  // 移动云盘
  if (l.includes('yun.139.com') || l.includes('mcloud.139.com') || l.includes('139.com')) return 'yidong';
  // 磁力 (magnet: 或 thunder:// 转 magnet 后)
  if (l.startsWith('magnet:') || l.includes('magnet')) return 'magnet';
  // ed2k
  if (l.startsWith('ed2k://') || l.includes('ed2k')) return 'ed2k';
  // telegra.ph 中间页 (L2, 需要进 L3 队列抓真链)
  if (l.includes('telegra.ph')) return 'telegra_ph';
  return 'other';
}

// ─── 1b. thunder:// 转 magnet URI ────────────────────────────────────────
// thunder://QUFmdHA6Ly9... 这种编码格式
// 解码 base64 后通常是 magnet:?xt=urn:btih:...
export function thunderToMagnet(thunderUrl: string): string | null {
  if (!thunderUrl || !thunderUrl.toLowerCase().startsWith('thunder://')) return null;
  try {
    const encoded = thunderUrl.slice('thunder://'.length);
    // 去掉前缀 "AA" 和后缀 "ZZ" (迅雷格式)
    let b64 = encoded;
    if (b64.startsWith('AA') && b64.endsWith('ZZ')) {
      b64 = b64.slice(2, -2);
    }
    const decoded = Buffer.from(b64, 'base64').toString('utf8');
    if (decoded.startsWith('magnet:')) return decoded;
    return null;
  } catch {
    return null;
  }
}

// ─── 2. detectCategoryByTitle(title, fallback?, primarySource?) ───────
// 业务规则 (2026-07-17):
//   - 先按 title 关键词判定
//   - 兜底时如果主链接是 magnet/ed2k, 返回 "磁力" category
export function detectCategoryByTitle(
  title: string,
  fallback: string = '其他',
  primarySource?: ResourceSource
): string {
  if (!title) {
    if (primarySource === 'magnet' || primarySource === 'ed2k') return '磁力';
    return fallback;
  }
  const upper = title.toUpperCase();
  const sortedRules = [...KEYWORD_CATEGORY_RULES].sort((a, b) => b.priority - a.priority);
  for (const rule of sortedRules) {
    for (const p of rule.patterns) {
      // 大小写不敏感匹配 (pattern 转大写)
      if (upper.includes(p.toUpperCase())) {
        return rule.category;
      }
    }
  }
  // 兜底: 关键词没命中时, 主链接是磁力 → 归"磁力"分类
  if (primarySource === 'magnet' || primarySource === 'ed2k') return '磁力';
  return fallback;
}

// ─── 3. detectImportChannel(link, hint?) ────────────────────────────
// 根据 link + 可选 hint 推断 import_channel
// hint 例子: 'tg_baidu' / 'tg_quark' / 'tg_music' / 'tg_music_quark'
// 业务规则 (2026-07-17):
//   - hint 优先 (用于来源追溯)
//   - 没 hint 时按主链接 source 反推
export function detectImportChannel(link: string, hint?: string): ImportChannel {
  if (hint) {
    const h = hint.toLowerCase();
    if (h.includes('baidu')) return 'tg_baidu';
    if (h.includes('quark')) return 'tg_quark';
    if (h.includes('music')) return 'tg_music';
    if (h.includes('zezemom') || h.includes('zzmm')) return 'zezemom_excel';
  }
  // 没 hint 时按主链接 source 反推
  const src = detectSource(link);
  if (src === 'baidu') return 'tg_baidu';
  if (src === 'quark') return 'tg_quark';
  if (src === '115') return 'zezemom_excel';
  // 磁力/迅雷/123 等 → 算 tg 其他
  return 'other';
}

// ─── 4. detectAccessLevel(channel, source) ──────────────────────────
// 业务规则 (2026-07-15 用户拍板):
//   zezemom_excel → basic (免费)
//   tg_* → vip (VIP 锁)
//   code (pay_type=code) → code (流明解锁)
export function detectAccessLevel(channel: ImportChannel, source?: ResourceSource): ResourceAccessLevel {
  if (channel === 'zezemom_excel') return 'basic';
  return 'vip';  // tg_baidu / tg_quark / tg_music / other 默认 vip
}

// ─── 5. normalizeLumenCost(value) ────────────────────────────────────
export function normalizeLumenCost(value: any): number {
  if (value === null || value === undefined || value === '') return 1;
  const n = parseInt(String(value), 10);
  if (isNaN(n) || n < 1) return 1;
  if (n > 100) return 100;
  return n;
}

// ─── 6. extractLinksFromTgMessage(msg) ──────────────────────────────
// 从 TG message 中提取链接 (link + text_link entities 的 href)
// 返回 [{ url, password?, type }]
// 业务规则 (2026-07-17):
//   - thunder:// 链接自动转 magnet URI
//   - 返回结果已按 SOURCE_SORT 优先级排序 (1=115 优先, 10=磁力最后)
export interface TgLink {
  url: string;
  password?: string;
  type: ResourceSource;
  sort: number;
}

export function extractLinksFromTgMessage(msg: any): TgLink[] {
  const rawLinks: TgLink[] = [];
  if (!msg) return rawLinks;

  const pushLink = (url: string, pwd?: string) => {
    if (!url) return;
    let realUrl = url;
    let type = detectSource(url);
    // thunder:// → 转 magnet
    if (url.toLowerCase().startsWith('thunder://')) {
      const magnetUri = thunderToMagnet(url);
      if (magnetUri) {
        realUrl = magnetUri;
        type = 'magnet';
      } else {
        // 解码失败, 当作迅雷 source 留 (TG 里也可能是无效编码)
        type = 'xunlei';
      }
    }
    if (!realUrl) return;
    rawLinks.push({
      url: realUrl,
      password: pwd,
      type,
      sort: SOURCE_SORT[type] ?? 99,
    });
  };

  // 1. 优先从 text array 里的 entity 拿 (TG Desktop export 2026-07-18 改用 array 格式)
  //    - text_link / link: 存 URL (dmhy 页面, 网盘链接)
  //    - code: 存磁力 (magnet:?xt=urn:btih:...) — 2026-07-18 才发现
  //    - plain: 普通文本, 跳过
  //    这是 tg-desktop 7.x 的新格式, 之前代码漏了 code 类型
  if (Array.isArray(msg.text)) {
    for (const t of msg.text) {
      if (typeof t === 'object' && t !== null && (t.type === 'text_link' || t.type === 'link' || t.type === 'code')) {
        const url = t.text || t.href || '';
        if (url.startsWith('http') || url.startsWith('magnet:') || url.startsWith('ed2k://') || url.toLowerCase().startsWith('thunder://')) {
          const pwd = url.startsWith('http') ? extractPasswordFromUrl(url) : undefined;
          pushLink(url, pwd);
        }
      }
    }
  }

  // 2. Fallback: 从 text_entities 拿 (老格式, 跟 text 平行)
  if (rawLinks.length === 0) {
    const entities = msg.text_entities || [];
    for (const e of entities) {
      if (e.type === 'link' || e.type === 'text_link') {
        const url = e.href || e.text;
        if (!url) continue;
        if (url.startsWith('http') || url.startsWith('magnet:') || url.startsWith('ed2k://') || url.toLowerCase().startsWith('thunder://')) {
          const pwd = url.startsWith('http') ? extractPasswordFromUrl(url) : undefined;
          pushLink(url, pwd);
        }
      }
    }
  }

  // 2. Fallback: 从 text 字符串中 regex 找链接 (如果 entities 缺失)
  if (rawLinks.length === 0 && Array.isArray(msg.text)) {
    const text = msg.text.filter((t: any) => typeof t === 'string').join('');
    // http/https
    const urlRegex = /https?:\/\/[^\s\u4e00-\u9fa5]+/g;
    const matches = text.match(urlRegex);
    if (matches) for (const url of matches) pushLink(url, extractPasswordFromUrl(url));
    // magnet
    const magnetRegex = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/g;
    const magnets = text.match(magnetRegex);
    if (magnets) for (const m of magnets) pushLink(m);
    // thunder
    const thunderRegex = /thunder:\/\/[a-zA-Z0-9=\/+=]+/gi;
    const thunders = text.match(thunderRegex);
    if (thunders) for (const t of thunders) pushLink(t);
  }

  // 3. Dedup (by url) + 按 sort 排序 (1=115 优先)
  const seen = new Set<string>();
  const dedup = rawLinks.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  dedup.sort((a, b) => a.sort - b.sort);
  return dedup;
}

// ─── 6b. pickPrimaryLink(links) ──────────────────────────────────────
// 从提取出的链接中选主链接 (sort 最小的, 即 115 优先)
// 业务规则 (2026-07-17): 资源入库用主链接 url + source, 其他链接入副表
export function pickPrimaryLink(links: TgLink[]): TgLink | null {
  if (!links || links.length === 0) return null;
  // 已排序, 取第一个
  return links[0];
}

// ─── 7. extractPasswordFromUrl(url) ─────────────────────────────────
// 提取网盘链接中的提取码 (百度 ?pwd=xxx 或夸克 ?code=xxx)
export function extractPasswordFromUrl(url: string): string | undefined {
  if (!url) return undefined;
  // 百度: https://pan.baidu.com/s/xxx?pwd=abc123
  let m = url.match(/[?&]pwd=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // 夸克: https://pan.quark.cn/s/xxx?code=abc123 (新版本)
  m = url.match(/[?&]code=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return undefined;
}

// ─── 8. extractTitleFromTgMessage(msg) ──────────────────────────────
// 从 TG message 提取标题
// 优先用 text 第一行, 否则用 "标题:xxx" 格式
export function extractTitleFromTgMessage(msg: any): string {
  if (!msg) return '';
  let text = '';
  if (typeof msg.text === 'string') {
    text = msg.text;
  } else if (Array.isArray(msg.text)) {
    // TG Desktop export 格式: text 是 string 数组, 含 entities
    text = msg.text
      .filter((t: any) => typeof t === 'string')
      .join('')
      .trim();
  }
  if (!text) return '';

  // 1. 找 "标题:xxx" 格式 (常见于资源分享群)
  const m = text.match(/标题[:：]\s*(.+?)(?:\n|$)/);
  if (m) return m[1].trim().slice(0, 200);

  // 2. 找 "名称:xxx" 格式
  const m2 = text.match(/(?:名称|片名)[:：]\s*(.+?)(?:\n|$)/);
  if (m2) return m2[1].trim().slice(0, 200);

  // 3. 第一行非空文本 (前 200 字符)
  const firstLine = text.split('\n').find((l: string) => l.trim().length > 0);
  if (firstLine) {
    return firstLine.trim().slice(0, 200);
  }

  return text.trim().slice(0, 200);
}

// ─── 9. extractTagsFromTgMessage(msg) ───────────────────────────────
// 从 TG message text 提取标签
// 找 #xxx 形式 或 末尾的 [标签] 形式
export function extractTagsFromTgMessage(msg: any): string[] {
  const tags: string[] = [];
  if (!msg) return tags;
  let text = '';
  if (Array.isArray(msg.text)) {
    text = msg.text.filter((t: any) => typeof t === 'string').join(' ');
  } else if (typeof msg.text === 'string') {
    text = msg.text;
  }
  if (!text) return tags;

  // #xxx 形式 (中文标签)
  const hashtagRegex = /#([^\s#]+)/g;
  let m;
  while ((m = hashtagRegex.exec(text)) !== null) {
    const tag = m[1].trim();
    if (tag.length > 0 && tag.length < 30 && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

// ─── 10. extractSizeFromTgMessage(msg) ──────────────────────────────
// 从 TG message text 提取大小信息
// 找 "大小:xxx" 格式 或 "XXGB" 格式
export function extractSizeFromTgMessage(msg: any): string {
  let text = '';
  if (Array.isArray(msg.text)) {
    text = msg.text.filter((t: any) => typeof t === 'string').join(' ');
  } else if (typeof msg.text === 'string') {
    text = msg.text;
  }
  if (!text) return '';

  // 大小:xxx 格式
  const m = text.match(/大[小檔]?[:：]\s*([^\n]+?)(?:\n|$)/);
  if (m) return m[1].trim().slice(0, 50);

  // XXGB / XXMB / XXKB 格式
  const m2 = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB|GiB|MiB|KiB))/i);
  if (m2) return m2[1].toUpperCase().replace(/\s+/g, '');

  return '';
}
