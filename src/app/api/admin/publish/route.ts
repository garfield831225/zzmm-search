// /api/admin/publish - 对外发布 (TG 频道)
// v2.1.3 锁版: QQ 群机器人走 go-cqhttp / Mirai 框架, 独立项目, 不在 publish 端点
// 这里只做 TG, v2.1.4 单独做 QQ
// POST: { resource_id, channels: ['tg'], content?, image_url? }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // TG 发图慢

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const TG_BOT_API = 'https://api.telegram.org/bot';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// === 推送到 TG 频道 ===
// 走 bot sendMessage / sendPhoto, 频道 chat_id = TG_CHANNEL_CHAT_ID
async function pushToTG(title: string, content: string, imageUrl?: string): Promise<{ ok: boolean; msg: string; raw?: any }> {
  const botToken = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHANNEL_CHAT_ID; // 频道 chat_id (e.g. -100xxxxxxxxxx)
  if (!botToken || !chatId) {
    return { ok: false, msg: 'TG 频道未配置 (缺 TG_BOT_TOKEN / TG_CHANNEL_CHAT_ID)' };
  }
  const text = `*${title}*\n\n${content}`;
  let url: string;
  let body: any;
  if (imageUrl) {
    url = `${TG_BOT_API}${botToken}/sendPhoto`;
    body = { chat_id: chatId, photo: imageUrl, caption: text, parse_mode: 'Markdown' };
  } else {
    url = `${TG_BOT_API}${botToken}/sendMessage`;
    body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json();
    return { ok: j.ok === true, msg: j.description || 'OK', raw: j };
  } catch (e: any) {
    return { ok: false, msg: 'TG 推送失败: ' + e.message };
  }
}

// === 端点 ===
// GET 查发布历史
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const a = adminOnly(auth);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });

  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`
    SELECT id, resource_id, channels, tg_ok, content, error, published_by, created_at
    FROM xx_publish_log
    ORDER BY created_at DESC LIMIT 50
  ` as any[];
  return NextResponse.json({ ok: true, items: r, count: r.length });
}

// POST 推 TG
// body: { resource_id, channels: ['tg'], content?, image_url? }
export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const a = adminOnly(auth);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const userId = Number(a.payload.id);

  const body = await req.json().catch(() => ({}));
  const resourceId = body.resource_id;
  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  const customContent = body.content;
  const imageUrl = body.image_url;
  if (!resourceId) return NextResponse.json({ error: '缺少 resource_id' }, { status: 400 });
  if (!channels.length) return NextResponse.json({ error: '请选择至少一个发布渠道' }, { status: 400 });
  if (!channels.includes('tg')) {
    return NextResponse.json({ error: 'v2.1.3 阶段仅支持 TG 频道, QQ 群机器人 v2.1.4 单独做' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  const rs = await sql`SELECT id, name, description, poster_url FROM xx_resources WHERE id = ${resourceId} LIMIT 1` as any[];
  if (!rs[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  const r = rs[0];

  // 组装发布内容
  const title = `🎬 ${r.name}`;
  const content = customContent || `${r.description || '泽泽妈妈资源'}\n\n👉 查看详情: https://zzmm-search.cc.cd/resources/${r.id}`;
  const img = imageUrl || r.poster_url;

  // 推 TG
  const tgResult = await pushToTG(title, content, img);
  const tgOk = tgResult.ok;
  const error = tgOk ? '' : `[tg] ${tgResult.msg}`;

  // 写日志
  try {
    await sql`
      INSERT INTO xx_publish_log (
        resource_id, channels, tg_ok, content, error, published_by, created_at
      ) VALUES (
        ${resourceId}, ${channels.join(',')}, ${tgOk}, ${content.slice(0, 1000)},
        ${error.slice(0, 500)}, ${userId}, NOW()
      )
    `;
  } catch (e: any) {
    console.error('[publish] log fail:', e.message);
  }

  return NextResponse.json({
    ok: tgOk,
    channels: [{ channel: 'tg', ok: tgOk, msg: tgResult.msg }],
    tg_ok: tgOk,
    message: tgOk ? '发布成功' : error,
  });
}
