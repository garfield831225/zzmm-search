import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function getUser(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization');
    if (!auth?.startsWith('Bearer ')) return null;
    const token = auth.replace('Bearer ', '');
    const payload = jwt.verify(token, (process.env.JWT_SECRET || 'cLWhs2015')) as any;
    return { id: Number(payload.id), group: String(payload.group || 'user').toLowerCase() };
  } catch { return null; }
}

const VALID_SOURCES = ['115','baidu','aliyun','quark','123','tianyi','magnet','ed2k','thunder','any'];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const sql = neon(process.env.DATABASE_URL || '');
  const { id } = await params;
  const tmdbId = parseInt(id, 10);
  if (!tmdbId) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const body = await request.json();
  const { tmdb_type = 'movie', title, year, region, poster_path, source_choices = [] } = body;

  // 校验 source_choices
  const validChoices = source_choices.filter((s: string) => VALID_SOURCES.includes(s));
  if (validChoices.length === 0) {
    return NextResponse.json({ error: '请至少选择一个网盘类型' }, { status: 400 });
  }
  // 'any' 不能跟其他共存
  const finalChoices = validChoices.includes('any') ? ['any'] : validChoices;

  // 写库
  const r = await sql`
    INSERT INTO xx_resource_requests (
      user_id, tmdb_id, tmdb_type, title, year, region, poster_path, source_choices, status
    ) VALUES (
      ${user.id}, ${tmdbId}, ${tmdb_type}, ${title || ''}, ${year || ''}, ${region || ''},
      ${poster_path || ''}, ${finalChoices}, 'pending'
    )
    RETURNING id, created_at
  ` as any[];

  return NextResponse.json({
    success: true,
    id: r[0]?.id,
    created_at: r[0]?.created_at,
    source_choices: finalChoices,
  });
}
