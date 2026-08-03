// 2026-07-28: pay-config sheet 列表
// 返 21-sheet 库的 sheet 名 + 每个 sheet 的 code 资源数
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { authAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = authAdmin(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const rows = await sql`
      SELECT doc_sheet,
             COUNT(*) as total,
             COUNT(*) FILTER (WHERE pay_type = 'code') as code_count
      FROM xx_resources
      WHERE status='active' AND doc_sheet IS NOT NULL
      GROUP BY doc_sheet
      ORDER BY total DESC, doc_sheet ASC
    ` as any[];

    // 加 "全部" + "未分类"
    const totalAll = (rows || []).reduce((s: number, r: any) => s + parseInt(r.total), 0);
    const codeAll = (rows || []).reduce((s: number, r: any) => s + parseInt(r.code_count), 0);

    // 未分类资源数
    const unclassified = await sql`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE pay_type = 'code') as code_count
      FROM xx_resources
      WHERE status='active' AND doc_sheet IS NULL
    ` as any[];

    return NextResponse.json({
      sheets: (rows || []).map((r: any) => ({
        name: r.doc_sheet,
        key: r.doc_sheet,
        total: parseInt(r.total),
        codeCount: parseInt(r.code_count),
      })),
      unclassified: {
        total: parseInt(unclassified[0]?.total || '0'),
        codeCount: parseInt(unclassified[0]?.code_count || '0'),
      },
      total: totalAll,
      codeTotal: codeAll,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
