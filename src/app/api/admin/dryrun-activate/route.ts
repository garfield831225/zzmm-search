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

    // 3. 关键词重分类预览: 多次单 pattern 求和 (避免 unsafe)
    const targets: any = [
      { new_cat: '电子书', patterns: ['有声', '电子书', '小说', 'EPUB', 'MOBI'] },
      { new_cat: '精品课', patterns: ['精品课', '课程', '讲座', '培训', '网课', '教学'] },
      { new_cat: '文档',   patterns: ['文档', '教程', '讲义', '课件', '教材'] },
      { new_cat: '音乐',   patterns: ['FLAC', 'Hi-Res', '专辑', 'SACD', 'DSD', 'HiFi'] },
    ];
    const reclassify: any = [];
    for (const t of targets) {
      for (const oldCat of ['合集', '电影', '剧集', '动漫', '综艺', '纪录片']) {
        let total = 0;
        for (const p of t.patterns) {
          const r = await sql`
            SELECT COUNT(*) as c FROM xx_resources
            WHERE doc_sheet = '非115导入' AND status='inactive'
              AND category = ${oldCat} AND name ILIKE ${'%' + p + '%'}
          `;
          total += parseInt(r[0]?.c || '0');
        }
        reclassify.push({ new_category: t.new_cat, old_category: oldCat, count: total });
      }
    }

    // 4. 各目标分类最终统计 (现有 + 即将重分类)
    const targetCounts: any = {};
    for (const t of ['电子书', '精品课', '文档', '音乐']) {
      const existing = await sql`SELECT COUNT(*) c FROM xx_resources WHERE doc_sheet = '非115导入' AND status='inactive' AND category = ${t}`;
      const reclassAdd = reclassify.filter((r: any) => r.new_category === t).reduce((a: number, b: any) => a + b.count, 0);
      targetCounts[t] = { existing: parseInt(existing[0]?.c || '0'), reclassify_add: reclassAdd, total: parseInt(existing[0]?.c || '0') + reclassAdd };
    }

    return NextResponse.json({
      mode: 'preview',
      inactive_total: parseInt(inactiveTotal[0]?.c || '0'),
      vip_impact: {
        basic_to_vip: parseInt(vipImpact[0]?.basic_to_vip || '0'),
        already_non_basic: parseInt(vipImpact[0]?.already_non_basic || '0'),
      },
      reclassify_preview: reclassify.filter((r: any) => r.count > 0),
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
    // B. 关键词重分类: 按优先级 (电子书 > 精品课 > 文档 > 音乐) 串行更新
    // 用 ILIKE (避免 regex 复杂性)
    const updates: any = [];
    // 优先级: 电子书 → 精品课 → 文档 → 音乐
    // (每条只命中第一个匹配的 pattern group)
    const targets = [
      { new_cat: '电子书', patterns: ['有声', '电子书', '小说', 'EPUB', 'MOBI'] },
      { new_cat: '精品课', patterns: ['精品课', '课程', '讲座', '培训', '网课', '教学'] },
      { new_cat: '文档',   patterns: ['文档', '教程', '讲义', '课件', '教材'] },
      { new_cat: '音乐',   patterns: ['FLAC', 'Hi-Res', '专辑', 'SACD', 'DSD', 'HiFi'] },
    ];
    // 先取所有 inactive 资源 id (激活后) - 这里假设已经 activate
    // 用 CTE 一次性更新
    // 1. 电子书 (最高优先级)
    for (const t of targets) {
      // 每个 pattern 单独 UPDATE, 避免一条记录被多个 pattern 命中
      // 但同 pattern 内一个 record 只被 update 一次
      let totalAffected = 0;
      for (const p of t.patterns) {
        const r = await sql`
          UPDATE xx_resources
          SET category = ${t.new_cat}, updated_at = NOW()
          WHERE doc_sheet = '非115导入' AND status = 'active' AND access_level = 'vip'
            AND category IN ('合集', '电影', '剧集', '动漫', '综艺', '纪录片')
            AND name ILIKE ${'%' + p + '%'}
        `;
        totalAffected += r.length || 0;
      }
      updates.push({ new_category: t.new_cat, affected: totalAffected });
    }
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
