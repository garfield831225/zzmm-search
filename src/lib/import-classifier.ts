// 2026-07-16: 导入分类公共工具
// 用途: 标准 Excel / 快速导入 / TG JSON 导入 / tg-organize 共用
// 不动泽泽妈妈 21-sheet 导入 (那个用 ZZMM_SHEET_MAP)

export type ResourceSource = '115' | 'baidu' | 'quark' | 'aliyun' | 'magnet' | 'ed2k' | 'telegra_ph' | 'other';
export type ResourceAccessLevel = 'basic' | 'vip' | 'code';
export type ResourcePayType = 'free' | 'code';
export type ImportChannel = 'zezemom_excel' | 'tg_baidu' | 'tg_quark' | 'tg_music' | 'other';

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
  // 磁力
  if (l.startsWith('magnet:') || l.includes('magnet')) return 'magnet';
  // ed2k
  if (l.startsWith('ed2k://') || l.includes('ed2k')) return 'ed2k';
  // telegra.ph 中间页 (L2, 需要进 L3 队列抓真链)
  if (l.includes('telegra.ph')) return 'telegra_ph';
  return 'other';
}

// ─── 2. detectCategoryByTitle(title, fallback?) ────────────────────
export function detectCategoryByTitle(title: string, fallback: string = '其他'): string {
  if (!title) return fallback;
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
  return fallback;
}

// ─── 3. detectImportChannel(link, hint?) ────────────────────────────
// 根据 link + 可选 hint 推断 import_channel
// hint 例子: 'tg_baidu' / 'tg_quark' / 'tg_music' / 'tg_music_quark'
export function detectImportChannel(link: string, hint?: string): ImportChannel {
  if (hint) {
    const h = hint.toLowerCase();
    if (h.includes('baidu')) return 'tg_baidu';
    if (h.includes('quark')) return 'tg_quark';
    if (h.includes('music')) return 'tg_music';
    if (h.includes('zezemom') || h.includes('zzmm')) return 'zezemom_excel';
  }
  // 默认按 source 推断
  const src = detectSource(link);
  if (src === 'baidu') return 'tg_baidu';
  if (src === 'quark') return 'tg_quark';
  if (src === '115') return 'zezemom_excel';  // 115 默认按 zezhe 走
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
export interface TgLink {
  url: string;
  password?: string;
  type: ResourceSource;
}

export function extractLinksFromTgMessage(msg: any): TgLink[] {
  const links: TgLink[] = [];
  if (!msg) return links;

  // 1. 优先从 text_entities 拿 (这是 TG Desktop export 的精准数据)
  const entities = msg.text_entities || [];
  for (const e of entities) {
    if (e.type === 'link' || e.type === 'text_link') {
      const url = e.href || e.text;
      if (url && url.startsWith('http')) {
        // 从 url 提取提取码 (网盘 链接后 ?pwd=xxx 或 #xxx)
        const pwd = extractPasswordFromUrl(url);
        links.push({ url, password: pwd, type: detectSource(url) });
      } else if (url && (url.startsWith('magnet:') || url.startsWith('ed2k://'))) {
        links.push({ url, type: detectSource(url) });
      }
    }
  }

  // 2. Fallback: 从 text 字符串中 regex 找链接 (如果 entities 缺失)
  if (links.length === 0 && Array.isArray(msg.text)) {
    const text = msg.text.filter((t: any) => typeof t === 'string').join('');
    const urlRegex = /https?:\/\/[^\s\u4e00-\u9fa5]+/g;
    const matches = text.match(urlRegex);
    if (matches) {
      for (const url of matches) {
        const pwd = extractPasswordFromUrl(url);
        links.push({ url, password: pwd, type: detectSource(url) });
      }
    }
    // magnet / ed2k
    const magnetRegex = /magnet:\?xt=urn:btih:[a-zA-Z0-9]+/g;
    const magnets = text.match(magnetRegex);
    if (magnets) for (const m of magnets) links.push({ url: m, type: 'magnet' });
  }

  // 3. Dedup (by url)
  const seen = new Set<string>();
  return links.filter(l => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
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
