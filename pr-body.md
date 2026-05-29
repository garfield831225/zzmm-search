## Summary
修复TMDB匹配逻辑6个核心bug，参考高手review诊断：

- **Bug 1**: 砍掉快速通道（top1+年份直接接受），所有结果必须过置信度校验
- **Bug 2**: 阈值0.3→0.5，增加精确匹配加分（完全一致=1.0，包含=0.85）
- **Bug 3**: substring hit从必要条件改为加分项（+0.1）
- **Bug 4**: tmdb_id只用整数（0=未匹配，>0=已匹配），去掉NOMATCH/GARBLED字符串
- **Bug 5**: PT站格式优先提取中文部分（如`[三体_ThreeBody_2024]`先取中文名搜索）
- **Bug 6**: 年份只作搜索参数，不从标题删除
- **Bug 7**: 简化搜索顺序，movie优先，tv次之，互搜

## Files changed
- `scripts/match-tmdb.mjs`: 核心匹配逻辑
- `src/app/api/admin/match-stats/route.ts`: 统计API适配整数tmdb_id