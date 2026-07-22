// 2026-07-18: 泽泽妈妈115文档 sheet 列表
// 取代网盘筛选按钮 — 泽泽妈妈区全是 115 链接, 按导入时 sheet 分类筛
import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sql = neon(process.env.DATABASE_URL || '');
  try {
    const sheets = await sql`
      SELECT doc_sheet, COUNT(*) as cnt
      FROM xx_resources
      WHERE status='active' AND import_channel='zezemom_excel' AND doc_sheet IS NOT NULL
      GROUP BY doc_sheet
      ORDER BY cnt DESC, doc_sheet ASC
    `;
    return NextResponse.json({
      total: sheets.reduce((s: number, r: any) => s + parseInt(r.cnt), 0),
      sheets: sheets.map((r: any) => ({ name: r.doc_sheet, count: parseInt(r.cnt) })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
