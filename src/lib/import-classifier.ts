// 2026-07-16: 导入分类公共工具
// 用途: 标准 Excel / 快速导入 / TG JSON 导入 / tg-organize 共用
// 不动泽泽妈妈 21-sheet 导入 (那个用 ZZMM_SHEET_MAP)
// 2026-07-17: 1对N 改造, 加 9 个新 source + magnet 兜底 category + 优先级排序

export type ResourceSource = '115' | 'baidu' | 'quark' | 'aliyun' | 'xunlei' | '123' | 'uc' | 'tianyi' | 'yidong' | 'magnet' | 'ed2k' | 'telegra_ph' | 'other';
export type ResourceAccessLevel = 'basic' | 'vip' | 'code';
export type ResourcePayType = 'free' | 'code';
export type ImportChannel = 'zezemom_excel' | 'tg_baidu' | 'tg_quark' | 'tg_music' | 'tg_aliyun' | 'tg_xunlei' | 'tg_123' | 'tg_uc' | 'tg_tianyi' | 'tg_yidong' | 'tg_magnet' | 'tg_115' | 'tg_telegraph' | 'tg_other' | 'other';

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
  // 电子书 / 有声 / 小说 / 2026-07-27 扩: 新书/豆瓣/书单/书推荐/合集/套装共/完整版
  { patterns: ['有声', '小说', 'EPUB', 'MOBI', 'AZW3', 'TXT电子书', 'txt电子',
    '新书', '豆瓣', '书单', '书推荐', '世界禁书', '读完这', '心理学神作', '霸榜',
    '豆瓣9', '豆瓣8', '豆瓣7', '豆瓣TOP', '看完这', '读完这5本', '藏了多少', '震撼',
    '套装共', '完整版',
  ], category: '电子书', priority: 100 },
  // 2026-07-27 扩: 短剧/微短剧/更新X集 归"剧集" (priority 50 介于动漫 75 和 综艺 25 之间, 不被电影吃掉)
  { patterns: ['短剧', '微短剧', '横屏短剧', '抖音短剧', '快手短剧', '付费小说', '合集总链', '集完', '连载至', '更新X集', '更新0', '更新1', '更新2', '更新3', '更新4', '更新5', '更新6', '更新7', '更新8', '更新9'], category: '剧集', priority: 50 },
  // 2026-07-27 扩: 1990s 老港片/台片"【稀有资源】" + 行业报告/电脑报/期号/杂志 归"电影"/"文档"
  { patterns: ['稀有资源', '稀有', '豆瓣TOP', '合集', '精选', '6部', '全集', '原声', '国粤', '国配',
    // 续扩: 老港片
    '恐怖', '悬疑', '惊悚', '伦理', '情色', '三级', '风月', '艳情',
    '邪典', 'Cult', '禁片', '邪教', 'Cult Film',
    'TVB', '邵氏', '嘉禾', '老港片', '老电影', '怀旧经典',
  ], category: '电影', priority: 36 },
  { patterns: ['行业报告', '电脑报', '期号', '杂志', '周报', '月报', '期刊', '体坛', '销售与市场', '静心守一', '遇见虎灵', '隐形冠军', '逻辑新引'], category: '文档', priority: 85 },
  // 精品课
  { patterns: ['精品课', '课程', '讲座', '培训', '网课', '教学', '教程课'], category: '精品课', priority: 90 },
  // 2026-07-27 软件/游戏 (免安装中文版/安卓/破解版/3DM/...) - 2026-07-27 改名"软件" (含游戏 + 工具)
  // 注意: 范围比"游戏"广, 因为"免安装中文版"也匹配工具 (录屏/转换器/IDM 等)
  // 用户视角看: 这些都是"软件"区, 不细分游戏/工具
  { patterns: [
    '免安装中文版', '免安装', '免安装版', '免安装绿色',
    '安卓手机游戏', '安卓游戏', '安卓',
    '单机联机', 'Steam', 'STEAM', 'Steam移植',
    '3DM', '破解版', 'v1.', 'v0.',
    '模拟器', 'PC策略', 'PC游戏', 'PC动作', '端游', '页游', '手游',
    '送修改器', '便携', '绿色版', '汉化版',
    '录屏', '转换器', '下载器', '文件搜索', '录屏大师',
    '影音', '播放器', '解码器', '驱动', '插件',
    'PDF工具', 'Office', 'Adobe', 'Photoshop', 'IDM',
  ], category: '软件', priority: 76 },
  // 文档 / 教辅 / 教材 / PDF
  { patterns: ['文档', '教程', '讲义', '课件', '教材', '学习资料', 'PDF', '教辅', '电子书籍'], category: '文档', priority: 80 },
  // 动漫 (2026-07-18 加: 动漫花园新番推送全归动漫)
  // 字幕组白名单 + 动漫/新番/Raws/Baha/B-Global/TVアニメ 等
  // 2026-07-27 加: 国漫 (国内动漫) / 更至 / 已刮削
  { patterns: [
    '动漫', '动画', '新番', 'Raws', 'RAW', 'Baha', 'B-Global', 'TVアニメ',
    '桜都', 'SweetSub', '喵萌', '酷漫', '星空', '千夏', 'MingY', 'MagicStar',
    '幻月', '爱恋&漫猫', '猫恋', 'NC-Raws', 'Lilith-Raws', 'Skymoon-Raws',
    'ANi', '天月', '猎户', 'JMAX', 'PorterRAWS', 'jibaketa', '肥猫压制',
    '爪爪', '铃风', '氢焰', '北宇治', '风都', '星河', '萌新乐园', '小猪动漫',
    '漫猫', '异世界', '后宫', '魔法少女', 'リリカル', 'Lycoris', 'Luminous',
    '国漫', '更至', '已刮削', '刮削',
  ], category: '动漫', priority: 75 },
  // 音乐
  { patterns: ['FLAC', 'Hi-Res', 'HiRes', '专辑', 'SACD', 'DSD', 'HiFi', '演唱会', 'mp3下载', 'APE', 'WAV', '无损'], category: '音乐', priority: 70 },
  // 体育
  { patterns: ['NBA', '球赛', '欧冠', '世界杯', '英超', '西甲', '德甲', '意甲', '中超', 'CBA'], category: '体育', priority: 60 },
  // 剧集 (连续剧标志) - 2026-07-27 扩: 完结 / EP / 已刮削 / 古装 / 内封简中
  { patterns: ['S0', 'E0', '连载', '更新至', '全', '第', '季', '完结', 'EP', '古装', '内封简中', '内封简繁', '内嵌简中'], category: '剧集', priority: 30 },
  // 综艺
  { patterns: ['综艺', '真人秀', '选秀'], category: '综艺', priority: 25 },
  // 纪录片
  { patterns: ['纪录片', '纪录', 'BBC', 'NHK'], category: '纪录片', priority: 20 },
  // 演唱会 (优先级比音乐低因为音乐 keyword 已经覆盖部分)
  { patterns: ['演唱会', 'live', 'LIVE', 'concert', 'Concert', '巡演', '音乐会'], category: '演唱会', priority: 65 },
  // 2026-07-22 加: 电影 keyword (2025) / WEB-4K / BluRay / WEB-DL / REMUX / 蓝光
  // 之前 4K / WEB-DL 等没分类 → 全走"其他", 现加电影规则
  // 2026-07-27 续扩: 剧情/奇幻/爱情/高码率/中文字幕/已刮削
  { patterns: [
    // 短链
    'S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9',
    // 网盘元数据
    'WEB-DL', 'web.dl', 'WEBRip', 'webrip', 'BluRay', 'bluray', 'BD',
    'REMUX', 'Remux', 'HDTV', 'UHD', 'HDR', 'DV', 'DoVi',
    '4K', '1080p', '720p', '2160p', '1440p',
    'x264', 'x265', 'H.264', 'H.265', 'HEVC', 'AVC', 'AV1',
    'DTS', 'DTS-HD', 'TrueHD', 'Atmos', 'DDP', 'EAC3', 'AC3', 'AAC',
    '蓝光', '原盘', '重制', '国配', '国语', '中字', '中英',
    // 类型标签
    '剧情', '奇幻', '爱情', '惊悚', '悬疑', '动作', '喜剧', '战争', '科幻', '犯罪', '古装',
    // 高码率 + 字幕
    '高码率', '中文字幕', '国语中字', '高码', '内封简中', '内封简繁',
    // FPS/HQ
    'HQ', 'FPS', '60FPS', 'KHDR', 'SDR', '臻彩', '高码', 'HDR10', 'Dolby',
    'WEB-', 'WEB',
  ], category: '电影', priority: 35 },
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
  // 123 网盘 (含官方短链服务: 123684 / 123865 / 123912 + 主域名 123pan.com/cn + share 子域)
  // 2026-07-22 修复: 之前只识别 123pan.com 和 123685, 漏了 123684/123865/123912 等短链
  // 短链服务的合法域名 (从 123684 主页 JS 拿到的):
  //   SOURCE_DOMAINS = ['123865.com', '123912.com', '123684.com', '123pan.com', '123pan.cn']
  if (
    l.includes('123865.com') ||
    l.includes('123912.com') ||
    l.includes('123684.com') ||
    l.includes('123pan.com') ||
    l.includes('123pan.cn')
  ) return '123';
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
// 业务规则 (2026-07-18 修正):
//   - 先按 title 关键词判定
//   - 兜底: 关键词没命中时, 主链接是 magnet/ed2k → 归"动漫" (因为动漫花园新番推送频道 99% 是动漫/日漫, 之前归"磁力"导致大量动漫资源被错误分类)
export function detectCategoryByTitle(
  title: string,
  fallback: string = '其他',
  primarySource?: ResourceSource
): string {
  if (!title) {
    if (primarySource === 'magnet' || primarySource === 'ed2k') return '动漫';
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
  // 兜底: 关键词没命中时, 主链接是磁力 → 归"动漫" (2026-07-18 改)
  if (primarySource === 'magnet' || primarySource === 'ed2k') return '动漫';
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
    if (h.includes('aliyun') || h.includes('alipan')) return 'tg_aliyun';
    if (h.includes('xunlei')) return 'tg_xunlei';
    if (h.includes('123')) return 'tg_123';
    if (h.includes('uc')) return 'tg_uc';
    if (h.includes('tianyi') || h.includes('189')) return 'tg_tianyi';
    if (h.includes('yidong') || h.includes('139')) return 'tg_yidong';
    if (h.includes('zezemom') || h.includes('zzmm')) return 'zezemom_excel';
  }
  // 没 hint 时按主链接 source 反推
  const src = detectSource(link);
  if (src === 'baidu') return 'tg_baidu';
  if (src === 'quark') return 'tg_quark';
  if (src === 'aliyun') return 'tg_aliyun';
  if (src === 'xunlei') return 'tg_xunlei';
  if (src === '123') return 'tg_123';
  if (src === 'uc') return 'tg_uc';
  if (src === 'tianyi') return 'tg_tianyi';
  if (src === 'yidong') return 'tg_yidong';
  if (src === '115') return 'zezemom_excel';
  // 磁力/ed2k → 算 tg 其他
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
  // 2026-08-16 8-15 swc shadow bug fix:
  //  变量名必须长 (≥10 字符), swc minify 不会短化到跟 for-of 循环变量同名,
  //  否则闭包内 pushLink 会把 rawLinks.push 错指到 for-of 循环变量上 → 0 link 提取
  //  旧名 rawLinks (8 字符) swc 会改成 e, 跟 for(let e of msg.text) 冲突
  const extractedLinksForReturn: TgLink[] = [];
  if (!msg) return extractedLinksForReturn;

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
    extractedLinksForReturn.push({
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
        // 2026-07-21: 修复! TG Desktop text_link 的 'text' 字段是显示文字(如"点击查看"),
        // 'href' 才是真正 URL. 之前 t.text || t.href 顺序错, 全部用错字段 → 0 link 提取
        const url = t.href || t.text || '';
        if (url.startsWith('http') || url.startsWith('magnet:') || url.startsWith('ed2k://') || url.toLowerCase().startsWith('thunder://')) {
          const pwd = url.startsWith('http') ? extractPasswordFromUrl(url) : undefined;
          pushLink(url, pwd);
        }
      }
    }
  }

  // 2. Fallback: 从 text_entities 拿 (老格式, 跟 text 平行)
  if (extractedLinksForReturn.length === 0) {
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
  if (extractedLinksForReturn.length === 0 && Array.isArray(msg.text)) {
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

  // 2b. Fallback: text 字符串中 regex 找链接 (兼容 string text + array text)
  // 2026-08-01: 原来只对 Array.isArray(text) 走, string text 永远 0 link
  if (extractedLinksForReturn.length === 0 && (Array.isArray(msg.text) || typeof msg.text === 'string')) {
    let text = '';
    if (typeof msg.text === 'string') {
      text = msg.text;
    } else if (Array.isArray(msg.text)) {
      text = msg.text.filter((t: any) => typeof t === 'string').join('');
    }
    if (text) {
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
  }

  // 3. Dedup (by url) + 按 sort 排序 (1=115 优先)
  const seen = new Set<string>();
  const dedup = extractedLinksForReturn.filter(l => {
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

// ─── 7b. parseStructuredMessage(msg) ─────────────────────────────────
// 2026-08-01: 通用字段解析器 - 按"字段名"匹配, 不按"整段 text 格式"匹配
// 背景: 百度网盘/讯雷等频道 (562) 用 "名称:xxx\n描述:xxx\n链接:..." 这种 bold 字段格式
//   之前 extractTitleFromTgMessage 用整段 text regex 匹配"名称:xxx", 失败时 fallback 到 firstLine
//   导致"name=名称"或"name=简介:xxx" 误识别
// 解法: 解析 text 数组, 识别 bold 字段名 + 紧跟的 plain entity value, 配对成 { 字段名: 值 }
//   然后从 fields['title'] 取 title, fields['description'] 取 desc 等
export interface ParsedFields {
  title?: string;        // 标题/名称/片名/Title/标题🎬
  description?: string;  // 描述/简介/概要/📝描述
  size?: string;         // 大小/容量/📁大小
  tags?: string[];       // 标签/Tags/🏷标签
  pushType?: string;     // 推送类型/来源/Type - 不入库, 仅供参考
  year?: string;         // 年份/Year
  category_hint?: string;// 分类/类型
  status?: string;       // 状态
  source_hint?: string;  // 来自/来自频道
  channel_hint?: string; // 频道
}

// 字段名 → 标准 key 映射 (含 emoji 前缀容忍)
const FIELD_MAP: Record<string, keyof ParsedFields> = {
  // 标题
  '标题': 'title', '名称': 'title', '片名': 'title', 'title': 'title', 'name': 'title',
  '🎬标题': 'title', '📛标题': 'title', '📌标题': 'title', '📺剧名': 'title', '🎞片名': 'title',
  '剧名': 'title', '作品名': 'title', '资源名': 'title', '资源标题': 'title',
  // 描述
  '描述': 'description', '简介': 'description', '概要': 'description', '剧情': 'description',
  'description': 'description', 'desc': 'description', 'summary': 'description', 'synopsis': 'description',
  'plot': 'description', '故事': 'description', '内容': 'description', '介绍': 'description',
  '📝描述': 'description', '📖简介': 'description', '📃简介': 'description',
  // 大小
  '大小': 'size', '容量': 'size', '文件大小': 'size', 'size': 'size', 'filesize': 'size',
  '📁大小': 'size', '📦大小': 'size', '💾大小': 'size', '🗂大小': 'size',
  // 标签
  '标签': 'tags', 'tags': 'tags', 'tag': 'tags', '🏷标签': 'tags', '#标签': 'tags', '关键词': 'tags',
  // 推送类型
  '推送类型': 'pushType', '来源': 'pushType', 'type': 'pushType', 'pushtype': 'pushType', 'source': 'pushType',
  // 年份
  '年份': 'year', 'year': 'year', '年代': 'year',
  // 分类
  '分类': 'category_hint', '类型': 'category_hint', 'category': 'category_hint',
  // 状态
  '状态': 'status', 'status': 'status',
  // 来源
  '来自': 'source_hint', '来自频道': 'source_hint', '投稿者': 'source_hint',
  // 频道
  '频道': 'channel_hint', 'channel': 'channel_hint',
};

// 字段名正则 (匹配 "名称：" "名称:" "名称 ：" 等 + emoji 前缀, 冒号可选)
// 2026-08-01: 冒号改可选 - 让 bold 字段名 "名称" 后跟 plain value 模式也能识别
const FIELD_LABEL_REGEX = new RegExp(
  '^([\\s\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]*)?' +  // 可选 emoji 前缀
  '(' + Object.keys(FIELD_MAP).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')' +
  '(?:\\s*[:：]\\s*)?(.*)$',
  'iu'
);

export function parseStructuredMessage(msg: any): ParsedFields {
  if (!msg) return {};
  const out: ParsedFields = {};
  if (typeof msg.text === 'string') {
    // 单字符串: 按行解析
    const lines = msg.text.split('\n');
    for (const line of lines) {
      const m = line.match(FIELD_LABEL_REGEX);
      if (m) {
        const key = FIELD_MAP[m[2]];
        const value = (m[3] || '').trim();
        if (key && value && !out[key]) {
          // tags 可能是 "🏷 标签: #tag1 #tag2" 形式
          if (key === 'tags') {
            out.tags = (value.match(/#([^\s#]+)/g) || []).map((s: string) => s.slice(1));
          } else {
            (out as any)[key] = value;
          }
        }
      }
    }
  } else if (Array.isArray(msg.text)) {
    // 数组: 遍历 entity, 识别 bold 字段名 + 紧跟的 plain/后续值
    // 关键修复: 看 bold entity 文本是不是字段名, 然后把同一 message 后续所有 text 内容当作 value
    //   直到下一个 "字段名" bold entity 或明显的链接分隔符
    let currentKey: keyof ParsedFields | null = null;
    let currentValue = '';
    const flush = () => {
      if (currentKey && currentValue.trim()) {
        const value = currentValue.trim();
        if (!out[currentKey]) {
          if (currentKey === 'tags') {
            out.tags = (value.match(/#([^\s#]+)/g) || []).map((s: string) => s.slice(1));
          } else {
            (out as any)[currentKey] = value;
          }
        }
      }
      currentKey = null;
      currentValue = '';
    };
    for (const t of msg.text) {
      if (typeof t === 'string') {
        // 2026-08-01: plain 字符串 (TG Desktop text array 第 0 元素) - 按行解析
        //   实际格式: "名称：xxx\n\n描述：yyy\n\n" (可能 1-3 段用 \n 分隔)
        //   必须按 \n split, 不能让 FIELD_LABEL_REGEX (冒号可选) 整段 match
        if (t.includes('\n')) {
          const lines = t.split('\n');
          for (const line of lines) {
            const trim = line.trim();
            if (!trim) continue;
            const m = trim.match(FIELD_LABEL_REGEX);
            if (m) {
              flush();
              currentKey = FIELD_MAP[m[2]] || null;
              // m[3] 是冒号后的部分, 如果为空 (冒号可选) → 视为需要后续 plain 补
              currentValue = m[3] || '';
            } else {
              // 不是字段行, 累加 (但只在没 currentKey 时)
              if (!currentKey) {
                currentValue += (currentValue ? '\n' : '') + trim;
              }
            }
          }
        } else {
          // 单行 plain 字符串
          const trim = t.trim();
          const m = trim.match(FIELD_LABEL_REGEX);
          if (m && (!currentKey || trim.startsWith(m[2]))) {
            flush();
            currentKey = FIELD_MAP[m[2]] || null;
            currentValue = m[3] || '';
          } else {
            currentValue += t;
          }
        }
      } else if (t && typeof t === 'object') {
        // 2026-08-01: { type: 'plain', text: 'xxx' } 对象类型 plain 也要 match 字段名
        if (t.type === 'plain' && t.text) {
          if (t.text.includes('\n')) {
            const lines = t.text.split('\n');
            for (const line of lines) {
              const trim = line.trim();
              if (!trim) continue;
              const m = trim.match(FIELD_LABEL_REGEX);
              if (m) {
                flush();
                currentKey = FIELD_MAP[m[2]] || null;
                currentValue = m[3] || '';
              } else {
                if (!currentKey) {
                  currentValue += (currentValue ? '\n' : '') + trim;
                }
              }
            }
          } else {
            const plainTrim = String(t.text).trim();
            const mPlain = plainTrim.match(FIELD_LABEL_REGEX);
            if (mPlain && (!currentKey || plainTrim.startsWith(mPlain[2]))) {
              flush();
              currentKey = FIELD_MAP[mPlain[2]] || null;
              currentValue = mPlain[3] || '';
            } else {
              currentValue += t.text;
            }
          }
        } else if (t.type === 'bold' && t.text) {
          // bold entity: 可能是字段名
          const m = String(t.text).match(FIELD_LABEL_REGEX);
          if (m) {
            // 是字段名 → flush 旧的, 开始新的
            flush();
            currentKey = FIELD_MAP[m[2]] || null;
            currentValue = m[3] || '';
          } else {
            // bold 但不是字段名, 加到 currentValue
            currentValue += t.text;
          }
        } else if (t.type === 'hashtag' && t.text) {
          // hashtag 单独累加 (常见于"标签: #xxx #yyy" 模式)
          if (currentKey === 'tags') {
            // 已经在 tags 字段, 加 #xxx
            if (!out.tags) out.tags = [];
            const tag = String(t.text).replace(/^#/, '').trim();
            if (tag && !out.tags.includes(tag)) out.tags.push(tag);
          } else {
            currentValue += t.text;
          }
        } else if (t.type === 'link' || t.type === 'text_link') {
          // 链接 entity: 不加到 value (extractLinksFromTgMessage 单独处理)
          // 但链接前可能有 "🔗 xxx：" 前缀, 不算值
          if (currentValue.trim()) {
            // 已经有 value, 把链接当作分隔符
            flush();
          }
        } else {
          // 其他 entity, 加到 currentValue
          if (t.text) currentValue += t.text;
        }
      }
    }
    flush();
  }
  return out;
}

// ─── 8. extractTitleFromTgMessage(msg) ──────────────────────────────
// 2026-08-02 v4: 严格按字段名匹配, 找不到 title 字段就返空 (不入库)
// 业务规则: 没"标题/名称/片名/Title"字段的消息不入库
// 背景: 之前 v3 fallback 用 description 清理前缀前 30 字符, 但 description 是剧情介绍不是片名
//   用户 library 显示"李红旗要办婚礼了！本想婚礼一切从简..."(描述截 30 字符) 当标题, 完全错误
// 修法: 严格按"名称/标题/片名/Title"字段名, 没字段返空 (调用方会跳过不入库)
// 用户的"短剧更新目录1/2/3"这种频道索引消息也会返空不入库 (没有"名称"字段, 是目录/索引)
export function extractTitleFromTgMessage(msg: any): string {
  if (!msg) return '';
  const fields = parseStructuredMessage(msg);
  // 1) 优先: title 字段 (名称/标题/片名/Title)
  if (fields.title && fields.title.trim()) {
    return fields.title.trim().slice(0, 200);
  }
  // 2) 老格式 fallback: 整段 text regex (匹配"标题/名称/片名/Title:xxx"开头)
  let text = '';
  if (typeof msg.text === 'string') {
    text = msg.text;
  } else if (Array.isArray(msg.text)) {
    text = msg.text.filter((t: any) => typeof t === 'string').join('').trim();
  }
  if (!text) return '';
  const m = text.match(/(?:标题|名称|片名|Title)[:：]\s*(.+?)(?:\n|$)/);
  if (m) {
    const v = m[1].trim();
    if (v) return v.slice(0, 200);
  }
  return '';  // 没"名称/标题/片名/Title"字段 → 不入库 (业务规则)
}

// ─── 9. extractTagsFromTgMessage(msg) ───────────────────────────────
// 2026-08-01: 用 parseStructuredMessage 优先从"标签"字段提取, fallback #xxx regex
export function extractTagsFromTgMessage(msg: any): string[] {
  if (!msg) return [];
  const fields = parseStructuredMessage(msg);
  if (fields.tags && fields.tags.length) return fields.tags.slice(0, 10);
  // Fallback: 整段 #xxx
  let text = '';
  if (Array.isArray(msg.text)) {
    text = msg.text.filter((t: any) => typeof t === 'string').join(' ');
  } else if (typeof msg.text === 'string') {
    text = msg.text;
  }
  if (!text) return [];
  const tags: string[] = [];
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
// 2026-08-01: 用 parseStructuredMessage 优先从"大小"字段提取, 支持 "📁 大小:5G" 格式
export function extractSizeFromTgMessage(msg: any): string {
  if (!msg) return '';
  const fields = parseStructuredMessage(msg);
  if (fields.size && fields.size.trim()) {
    return fields.size.trim().slice(0, 50);
  }
  // Fallback: regex 找 XXGB / XXMB
  let text = '';
  if (Array.isArray(msg.text)) {
    text = msg.text.filter((t: any) => typeof t === 'string').join(' ');
  } else if (typeof msg.text === 'string') {
    text = msg.text;
  }
  if (!text) return '';
  const m2 = text.match(/(\d+(?:\.\d+)?\s*(?:GB|MB|KB|TB|GiB|MiB|KiB))/i);
  if (m2) return m2[1].toUpperCase().replace(/\s+/g, '');
  return '';
}

// ─── 10b. extractDescriptionFromTgMessage(msg) ──────────────────────
// 2026-08-01: 提取描述 (可作 overview/剧情), 不入库 name
export function extractDescriptionFromTgMessage(msg: any): string {
  if (!msg) return '';
  const fields = parseStructuredMessage(msg);
  return (fields.description || '').trim().slice(0, 2000);
}
