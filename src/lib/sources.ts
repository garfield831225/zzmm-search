// 网盘 source 字典 + 自动识别
// 数据库表: xx_source_types (12 种)
// 详见 scripts/create-source-types.mjs

export interface SourceType {
  code: string;            // '115' / 'baidu' / 'quark' / 'aliyun' / 'xunlei' / '123pan' / 'tianyi' / 'uc' / 'cmcc' / 'pikpak' / 'magnet' / 'ed2k'
  display_name: string;    // '115 网盘' 等
  icon: string;            // '🔵' 等
  color: string;           // '#FF6B00' 等
  sort_order: number;
  domain_hint: string;     // '115.com|115cdn.com|anxia.com' (| 分隔多个域名)
}

// 12 种网盘字典（与服务端 DB xx_source_types 同步；DB 是 source of truth）
export const SOURCE_DICT: SourceType[] = [
  { code: '115',     display_name: '115 网盘',  icon: '🔵', color: '#FF6B00', sort_order: 10, domain_hint: '115.com|115cdn.com|anxia.com' },
  { code: 'baidu',   display_name: '百度网盘',  icon: '🟢', color: '#1296DB', sort_order: 20, domain_hint: 'pan.baidu.com' },
  { code: 'quark',   display_name: '夸克网盘',  icon: '🟡', color: '#FFD700', sort_order: 30, domain_hint: 'pan.quark.cn' },
  { code: 'aliyun',  display_name: '阿里云盘',  icon: '🟠', color: '#FF6A00', sort_order: 40, domain_hint: 'aliyundrive.com|alipan.com' },
  { code: 'xunlei',  display_name: '迅雷云盘',  icon: '🔷', color: '#0066CC', sort_order: 50, domain_hint: 'pan.xunlei.com' },
  { code: '123pan',  display_name: '123 云盘',  icon: '🟤', color: '#FF4500', sort_order: 60, domain_hint: '123pan.com|123pan.cn' },
  { code: 'tianyi',  display_name: '天翼云盘',  icon: '🔴', color: '#E60012', sort_order: 70, domain_hint: 'cloud.189.cn' },
  { code: 'uc',      display_name: 'UC 网盘',   icon: '🟣', color: '#7B61FF', sort_order: 80, domain_hint: 'drive.uc.cn' },
  { code: 'cmcc',    display_name: '中国移动云盘', icon: '🟦', color: '#005BAC', sort_order: 90, domain_hint: 'yun.139.com' },
  { code: 'pikpak',  display_name: 'PikPak',    icon: '⚫', color: '#000000', sort_order: 100, domain_hint: 'mypikpak.com|pikpak.com' },
  { code: 'magnet',  display_name: '磁力链接',  icon: '🧲', color: '#666666', sort_order: 200, domain_hint: 'magnet:' },
  { code: 'ed2k',    display_name: '电驴链接',  icon: '🐴', color: '#8B4513', sort_order: 210, domain_hint: 'ed2k://' },
];

// 字典快查表
const SOURCE_BY_CODE: Record<string, SourceType> = Object.fromEntries(
  SOURCE_DICT.map(s => [s.code, s])
);

// 从 link 域名推断 source code
// 优先级：magnet/ed2k (协议) > 域名匹配
export function inferSourceFromLink(link: string | null | undefined): string {
  if (!link) return 'unknown';
  const l = link.toLowerCase();
  // 协议级
  if (l.startsWith('magnet:')) return 'magnet';
  if (l.startsWith('ed2k://')) return 'ed2k';
  // 域名匹配
  for (const t of SOURCE_DICT) {
    const domains = t.domain_hint.split('|');
    for (const d of domains) {
      if (l.includes(d.toLowerCase())) return t.code;
    }
  }
  return 'unknown';
}

// 取 source 显示信息（找不到时返回兜底）
export function getSourceInfo(code: string | null | undefined): SourceType {
  if (!code) {
    return { code: 'unknown', display_name: '未知来源', icon: '❓', color: '#999', sort_order: 999, domain_hint: '' };
  }
  return SOURCE_BY_CODE[code] || { code, display_name: code, icon: '❓', color: '#999', sort_order: 999, domain_hint: '' };
}

// 分组排序 (按 sort_order)
export function groupResourcesBySource<T extends { source: string }>(items: T[]): Array<{ source: SourceType; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const code = item.source || 'unknown';
    if (!map.has(code)) map.set(code, []);
    map.get(code)!.push(item);
  }
  return Array.from(map.entries())
    .map(([code, items]) => ({ source: getSourceInfo(code), items }))
    .sort((a, b) => a.source.sort_order - b.source.sort_order);
}