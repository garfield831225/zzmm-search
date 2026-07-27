// 2026-07-27: sheet 名称集中映射 (写死合并规则)
// 2026-07-27 用户拍板 (最新版, 2026-07-27 11:30 修正):
//   - 4K原盘 → 原盘资源 (合并到原盘资源)  ← 21-sheet 库"4K原盘"是别名
//   - 国产剧/欧美剧/韩日剧/港台剧 → 保留 4 个独立 sheet (不合并)
//   - 外语电影/华语电影/动画电影/REMUX → 保留独立 (不合并)
//   - 历史"剧集"/"电影"母分类 (parseZZMM 错误合并产生的脏分类) → 删除
//   - 历史"追更区"/"体育"/"原盘"别名 → 已被 SQL UPDATE 一次性修过
//
// 任何 import 流程 (Excel/TG/cron/手工) 写入 doc_sheet 之前**必须**调用 normalizeDocSheet(),
// 否则会重新出现"4K原盘"/"剧集"/"电影"这些不该有的 sheet。
//
// 改合并规则: 只改本文件 SHEET_MERGE_MAP 即可, 全部 import 流程自动生效。
import { neon } from '@neondatabase/serverless';

// 写死的合并映射表 (source → canonical target)
// 21-sheet 库的实际别名:
//   - "4K原盘" → "原盘资源" (合并到主分类, 旧规则里"原盘→原盘资源"是历史 SQL UPDATE 一次性的, 实际 sheet 名是"原盘资源"/"4K原盘")
export const SHEET_MERGE_MAP: Record<string, string> = {
  '4K原盘': '原盘资源',
  '原盘': '原盘资源',  // 历史脏数据兜底 (parseZZMM 错误把"原盘"当母分类)
  '追更区': '每日更新',  // 历史脏数据兜底
  '体育': '体育赛事',    // 历史脏数据兜底
};

// 应该删除的 sheet (parseZZMM 错误产生的母分类, 21-sheet 库根本不存在)
// 历史 SQL DELETE 一次, 后续 import 必须保证不再写这两个值
export const SHEET_DELETE_LIST: string[] = [
  '剧集', '电影',
];

// 所有合法的 sheet 名 (允许 25-sheet 库使用, 写入其他值会被映射到合法的或删除)
// 2026-07-27 当前合法 sheet 列表 (zzmm-search 21-sheet 库 + 我们新增的)
export const VALID_SHEETS: string[] = [
  '原盘资源', '4K原盘',
  '外语电影', '华语电影', '动画电影', '系列电影', 'REMUX',
  '动漫',
  '国产剧', '欧美剧', '韩日剧', '港台剧',
  '纪录片', '综艺', '演唱会', '音乐', '少儿频道',
  '每日更新', '合集', '体育赛事',
  // 隐藏的"导航首页"不算分类, 但能写入
  '导航首页',
];

/**
 * 把任意 sheet 名规范化成合法的 sheet
 * - 如果在 SHEET_DELETE_LIST 里, 抛错 (调用方应该 DELETE 该资源, 不应该写入)
 * - 如果在 SHEET_MERGE_MAP 里, 返回合并后的 sheet
 * - 如果在 VALID_SHEETS 里, 原样返回
 * - 都不在, 原样返回 (新 sheet 名允许, 用户后续可以加进 VALID_SHEETS)
 */
export function normalizeDocSheet(sheet: string | null | undefined): string | null {
  if (!sheet) return null;
  if (SHEET_DELETE_LIST.includes(sheet)) {
    throw new Error(
      `SHEET_DELETE_LIST: "${sheet}" 不允许写入, 应 DELETE 该资源. ` +
      `这是写死的合并规则 (2026-07-27 用户拍板). ` +
      `改 src/lib/sheet-mapping.ts SHEET_DELETE_LIST 才能放行.`
    );
  }
  return SHEET_MERGE_MAP[sheet] || sheet;
}

/**
 * 安全的 normalizeDocSheet: 遇到 SHEET_DELETE_LIST 返回 null (不抛错)
 * 用于批量 UPDATE / 历史数据清洗
 */
export function safeNormalizeDocSheet(sheet: string | null | undefined): string | null {
  if (!sheet) return null;
  if (SHEET_DELETE_LIST.includes(sheet)) return null;
  return SHEET_MERGE_MAP[sheet] || sheet;
}

/**
 * 从 category 字段推 doc_sheet (2026-07-27 用户拍板逻辑)
 *  - 直接用 normalizeDocSheet 处理 (自动应用合并规则)
 *  - 找不到匹配时返回 null (调用方应保留原逻辑)
 */
export function inferDocSheetFromCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  return safeNormalizeDocSheet(category);
}

/**
 * 批量清洗 doc_sheet 字段 (历史数据修正)
 * - 应用 SHEET_MERGE_MAP
 * - 标记 SHEET_DELETE_LIST 的资源为待删
 * 返回: { merged: 改的条数, deleted_ids: [id1, id2, ...] }
 */
export async function cleanDocSheets(sqlFn: ReturnType<typeof neon>): Promise<{ merged: number; deletedIds: number[] }> {
  // 1. 应用合并
  let merged = 0;
  for (const [from, to] of Object.entries(SHEET_MERGE_MAP)) {
    const r = await sqlFn`
      UPDATE xx_resources
      SET doc_sheet = ${to}
      WHERE status='active' AND doc_sheet = ${from}
      RETURNING id
    ` as any[];
    merged += r.length;
  }
  // 2. 找出待删的 id
  const toDelete = await sqlFn`
    SELECT id FROM xx_resources
    WHERE status='active' AND doc_sheet = ANY(${SHEET_DELETE_LIST})
  ` as any[];
  return { merged, deletedIds: toDelete.map((r: any) => r.id) };
}
