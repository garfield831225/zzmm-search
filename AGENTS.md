# zzmm-search 项目关键决策 (2026-06-01)

## TMDB 匹配逻辑（必须严格遵守，不得自行"优化"）

**所有 TMDB 匹配代码必须参考 `src/app/api/cron/match-task/route.ts` 的 `getTypesForCategory` 函数。**

```typescript
function getTypesForCategory(category: string, sub_type: string | null, season: number | null) {
  if (season !== null) return ['tv'];
  if (category === '连载' || category === '剧集' || category === '动漫' || category === '少儿频道' || category === '综艺') return ['tv'];
  if (category === '演唱会' || category === '电影' || category === '系列电影') return ['movie'];
  if (category === '纪录片') return ['tv', 'movie'];
  if (category === '原盘') {
    if (['电影', '动画电影', '演唱会', '3D原盘'].includes(sub_type || '')) return ['movie'];
    return ['tv'];  // 原盘默认先 TV，不是 multi，不是先 movie
  }
  if (category === 'REMUX') return ['movie'];
  return null;
}
```

### 核心原则
- **原盘默认查 `movie`**：没有 sub_type 的原盘资源默认查 TMDB movie 类型。
- **4K原盘**：`sub_type=电影`，查 `movie`。
- **3D原盘**：`sub_type=3D原盘`，查 `movie`。
- **严禁用 `search/multi`**：不能用 `multi` 类型代替类别判断，所有搜索必须指定类型。
- **搜索 API 也必须遵守**：任何新写的搜索/匹配逻辑必须参考此函数。