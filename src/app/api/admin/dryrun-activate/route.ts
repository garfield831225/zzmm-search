// admin 端点: 把 16,067 inactive 资源激活 + 设置 VIP 属性 + 按关键词重分类
// 用 ?dryRun=1 看效果, ?execute=1 真跑
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const mode = request.nextUrl.searchParams.get('mode'); // 'preview' | 'execute-vip' | 'execute-reclassify' | 'verify'
  if (key !== 'zzmm-batch-test') return NextResponse.json({ error: 'no' }, { status: 403 });
  if (!['preview', 'execute-vip', 'execute-reclassify', 'verify', 'rollback'].includes(mode || '')) {
    return NextResponse.json({ error: 'mode required: preview|execute-vip|execute-reclassify|verify|rollback' }, { status: 400 });
  }
  const sql = neon(process.env.DATABASE_URL || '');

  // 备份: 把原始 status/access_level/pay_type/category 写到 backup_logs (一次性, 用 doc_sheet 标记)
  // 这里不写新表, 用一个简单的 checkpoint 字段
  // 实际上我们只在 dryRun 阶段 preview, 真跑有 verify 兜底

  if (mode === 'preview') {
    // 1. 当前 inactive 总数
    const inactiveTotal = await sql`SELECT COUNT(*) c FROM xx_resources WHERE doc_sheet = '非115导入' AND status='inactive'`;

    // 2. 即将激活 + 设 vip 的影响
    const vipImpact = await sql`
      SELECT
        SUM(CASE WHEN access_level = 'basic' AND pay_type = 'free' THEN 1 ELSE 0 END) as basic_to_vip,
        SUM(CASE WHEN access_level != 'basic' OR pay_type != 'free' THEN 1 ELSE 0 END) as already_non_basic
      FROM xx_resources WHERE doc_sheet = '非115导入' AND status='inactive'
    `;

    // 3. 关键词重分类预览: 在合集/电影/剧集/动漫里, 按 name 关键词重新分类
    // 优先级: 有声/电子书/小说 → 电子书; 精品课/课程/讲座 → 精品课; 文档/PDF/教程 → 文档; FLAC/Hi-Res → 音乐
    const reclassify = await sql`
      WITH classified AS (
        SELECT id, category, name,
          CASE
            WHEN name ~* '(\y有声\y|\y电子书\y|\y小说\y|\yEPUB\y|\yMOBI\y)' THEN '电子书'
            WHEN name ~* '(\y精品课\y|\y课程\y|\y讲座\y|\y培训\y|\y网课\y|\y教学\y)' THEN '精品课'
            WHEN name ~* '(\y文档\y|\yPDF\y|\y教程\y|\y讲义\y|\y课件\y|\y教材\y)' THEN '文档'
            WHEN name ~* '(\yFLAC\y|\yHi-Res\y|\y专辑\y|\y演唱会\y|\ySACD\y|\yDSD\y|\yHiFi\y)' THEN '音乐'
            ELSE NULL
          END as new_category
        FROM xx_resources
        WHERE doc_sheet = '非115导入' AND status='inactive'
          AND category IN ('合集', '电影', '剧集', '动漫', '综艺', '纪录片')
      )
      SELECT new_category, category as old_category, COUNT(*) as c
      FROM classified WHERE new_category IS NOT NULL
      GROUP BY new_category, category ORDER BY new_category, c DESC
    `;

    // 4. 关键词命中总数 (按目标分类)
    const targetCounts: any = {};
    for (const t of ['电子书', '精品课', '文档', '音乐']) {
      const r = await sql`
        SELECT COUNT(*) c FROM xx_resources
        WHERE doc_sheet = '非115导入' AND status='inactive'
          AND (category = ${t}
               OR (category IN ('合集','电影','剧集','动漫','综艺','纪录片')
                   AND (
                     ${t === '电子书'}::bool AND name ~* '(\y有声\y|\y电子书\y|\y小说\y|\yEPUB\y|\yMOBI\y)'
                     OR ${t === '精品课'}::bool AND name ~* '(\y精品课\y|\y课程\y|\y讲座\y|\y培训\y|\y网课\y|\y教学\y)'
                     OR ${t === '文档'}::bool AND name ~* '(\y文档\y|\yPDF\y|\y教程\y|\y讲义\y|\y课件\y|\y教材\y)'
                     OR ${t === '音乐'}::bool AND name ~* '(\yFLAC\y|\yHi-Res\y|\y专辑\y|\y演唱会\y|\ySACD\y|\yDSD\y|\yHiFi\y)'
                   )
               ))
      `;
      targetCounts[t] = parseInt(r[0]?.c || '0');
    }

    return NextResponse.json({
      mode: 'preview',
      inactive_total: parseInt(inactiveTotal[0]?.c || '0'),
      vip_impact: {
        basic_to_vip: parseInt(vipImpact[0]?.basic_to_vip || '0'),
        already_non_basic: parseInt(vipImpact[0]?.already_non_basic || '0'),
      },
      reclassify_preview: reclassify,
      target_counts_after_reclassify: targetCounts,
    });
  }

  if (mode === 'execute-vip') {
    // A. 把 16,067 inactive 激活 + access_level='vip' + pay_type='vip'
    const before = await sql`SELECT COUNT(*) c FROM xx_resources WHERE doc_sheet = '非115导入' AND status='inactive'`;
    await sql`
      UPDATE xx_resources
      SET status = 'active', access_level = 'vip', pay_type = 'vip', updated_at = NOW()
      WHERE doc_sheet = '非115导入' AND status = 'inactive'
    `;
    const after = await sql`SELECT COUNT(*) c FROM xx_resources WHERE doc_sheet = '非115导入' AND status='inactive'`;
    const active = await sql`SELECT COUNT(*) c FROM xx_resources WHERE doc_sheet = '非115导入' AND access_level='vip' AND status='active'`;
    return NextResponse.json({
      mode: 'execute-vip',
      before_inactive: parseInt(before[0]?.c || '0'),
      after_inactive: parseInt(after[0]?.c || '0'),
      now_active_vip: parseInt(active[0]?.c || '0'),
    });
  }

  if (mode === 'execute-reclassify') {
    // B. 关键词重分类: 把合集/电影/剧集/动漫/综艺/纪录片里, 关键词命中的改为目标分类
    const updates: any = [];
    const targets = [
      { new_cat: '电子书', pattern: '(\y有声\y|\y电子书\y|\y小说\y|\yEPUB\y|\yMOBI\y)' },
      { new_cat: '精品课', pattern: '(\y精品课\y|\y课程\y|\y讲座\y|\y培训\y|\y网课\y|\y教学\y)' },
      { new_cat: '文档', pattern: '(\y文档\y|\yPDF\y|\y教程\y|\y讲义\y|\y课件\y|\y教材\y)' },
      { new_cat: '音乐', pattern: '(\yFLAC\y|\yHi-Res\y|\y专辑\y|\y演唱会\y|\ySACD\y|\yDSD\y|\yHiFi\y)' },
    ];
    for (const t of targets) {
      const r = await sql`
        UPDATE xx_resources
        SET category = ${t.new_cat}, updated_at = NOW()
        WHERE doc_sheet = '非115导入' AND status = 'active' AND access_level = 'vip'
          AND category IN ('合集', '电影', '剧集', '动漫', '综艺', '纪录片')
          AND name ~* ${t.pattern}
      `;
      updates.push({ new_category: t.new_cat, affected: r.length || 0 });
    }
    // 各分类最终统计
    const counts = await sql`
      SELECT category, COUNT(*) c FROM xx_resources
      WHERE doc_sheet = '非115导入' AND status='active' AND access_level='vip'
      GROUP BY category ORDER BY c DESC
    `;
    return NextResponse.json({
      mode: 'execute-reclassify',
      updates,
      final_counts: counts,
    });
  }

  if (mode === 'verify') {
    const v = await sql`
      SELECT category, status, access_level, pay_type, COUNT(*) c
      FROM xx_resources
      WHERE doc_sheet = '非115导入'
      GROUP BY category, status, access_level, pay_type
      ORDER BY c DESC LIMIT 30
    `;
    return NextResponse.json({ mode: 'verify', distribution: v });
  }

  if (mode === 'rollback') {
    // 紧急回滚: 把 16k 改回 inactive + basic + free
    const r = await sql`
      UPDATE xx_resources
      SET status = 'inactive', access_level = 'basic', pay_type = 'free', updated_at = NOW()
      WHERE doc_sheet = '非115导入' AND status = 'active' AND access_level = 'vip' AND pay_type = 'vip'
    `;
    return NextResponse.json({ mode: 'rollback', affected: r.length || 0 });
  }

  return NextResponse.json({ error: 'unreachable' }, { status: 500 });
}
