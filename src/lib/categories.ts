// 分类体系唯一真相源 (2026-10-29 新建)
//
// 为什么要建这个文件:
//   之前 CATEGORIES / NONFILM_CATEGORIES / NONFILM_CATS 在 6 个文件里各写一份, 互相漂移:
//   - DB 里实际有 28 个 category, 但首页筛选器只有 12 个 → **短剧 84425 条完全筛不出来**
//   - NONFILM_CATS 只列了 6 个 → 软件(10719) / PC游戏 / Swtich游戏 / 学习资料 / 有声书
//     / 导航首页 / 合集(4288) / 其他(19561) / 独立付费 全部混进首页「影视专区」
//   - 用户看到的现象: 影视专区里出现软件安装包和课程, 而短剧一条都找不到
//
// 规则:
//   1. 影视区 = 影视作品 (电影/剧集/短剧/动漫/综艺/纪录片/演唱会/少儿频道/系列电影)
//      + 品质标签 (原盘/REMUX) + 连载状态 (连载/追更区)
//   2. 非影视区 = 有专属数据源或非视听内容 (音乐→MusicBrainz, 体育→Football API,
//      电子书/文档/精品课/学习资料→文档库, 游戏/软件→无匹配源)
//   3. 分类值必须跟 xx_resources.category 的实际取值一致

/** 首页「影视专区」筛选器 (zone=film) */
export const FILM_CATEGORIES = [
  '全部',
  // 内容类型
  '电影', '剧集', '短剧', '动漫', '综艺', '纪录片', '演唱会', '少儿频道', '系列电影',
  // 品质
  '原盘', 'REMUX',
  // 连载状态
  '连载', '追更区',
];

/** 非影视区筛选器 (zone=nonfilm) */
export const NONFILM_CATEGORIES = [
  '全部',
  '音乐', '电子书', '文档', '精品课', '学习资料', '有声书',
  '软件', '游戏', 'PC游戏', 'Swtich游戏', '体育', '合集', '独立付费', '其他',
];

/**
 * 属于「非影视」的 category 值 (DB 里的实际取值)
 *   - zone=film + 全部 → NOT (category = ANY(NONFILM_CATS)) → 影视区不出现非影视内容
 *   - zone=nonfilm + 全部 → category = ANY(NONFILM_CATS)
 *   - 注意: 「其他」也在这 → 那 19561 条待重新归类的先隔离出影视区 (用户铁律: 最终要消灭「其他」)
 */
export const NONFILM_CATS = [
  '音乐', '体育', '游戏', 'PC游戏', 'Swtich游戏',
  '电子书', '精品课', '文档', '学习资料', '有声书',
  '软件', '导航首页', '合集', '独立付费', '其他',
];

/** 影视区的分类集合 (给 SQL 用) */
export const FILM_CATS = FILM_CATEGORIES.filter((c) => c !== '全部');

/** 后台手动匹配页的分类 (要含非影视里能匹配 TMDB 的部分) */
export const MATCH_CATEGORIES = [
  '全部', '电影', '剧集', '短剧', '动漫', '少儿频道', '综艺', '纪录片',
  '演唱会', '原盘', 'REMUX', '系列电影', '连载', '合集',
];

/** 跟 DB 实际 category 取值对齐的完整清单 (后台/统计用) */
export const ALL_CATEGORIES = [
  '电影', '剧集', '短剧', '动漫', '综艺', '纪录片', '演唱会', '少儿频道', '系列电影',
  '原盘', 'REMUX', '连载', '追更区',
  '音乐', '电子书', '文档', '精品课', '学习资料', '有声书',
  '软件', '游戏', 'PC游戏', 'Swtich游戏', '体育', '合集', '独立付费', '导航首页', '其他',
];

// ─── 分类 → TMDB 类型 (2026-10-29) ───────────────────────────────────────
// 为什么要收进真相源:
//   前端判定「这条资源能不能显示 TMDB 海报」用的是 category → tmdb_type 的硬编码映射
//   (search/route.ts 的 TV_CATS_FILTER / MOVIE_CATS_FILTER), 匹配引擎用的是另一套
//   → 两边一漂移, 匹配写进去的 tmdb_type 跟前端期望的对不上, **海报直接不显示**
//   典型: 纪录片 前端只认 tv, 引擎却能匹配 movie → 匹配上了但没封面
//
// 返回 null = 不限类型 (原盘/短剧/合集 这类两种类型都合理的)
export const TMDB_TV_CATS = new Set([
  '连载', '剧集', '动漫', '综艺', '少儿频道', '短剧',
]);
export const TMDB_MOVIE_CATS = new Set([
  '电影', '华语电影', '外语电影', '动画电影', '演唱会', 'REMUX', '系列电影',
]);

/** 该分类能接受哪些 TMDB 类型 (null = 都行) */
export function acceptableTmdbTypes(category: string): ('tv' | 'movie')[] | null {
  // 纪录片: 业务规则是"先 tv 后 movie", 两种都合法
  if (category === '纪录片') return ['tv', 'movie'];
  if (TMDB_TV_CATS.has(category)) return ['tv'];
  if (TMDB_MOVIE_CATS.has(category)) return ['movie'];
  return null;
}
