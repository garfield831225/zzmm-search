// /api/admin/publish - 对外发布双发
// 一键推送到 QQ 公众号 + TG 频道 (bot API)
// POST: { resource_id, channels: ['qq', 'tg'], content?, image_url? }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 双发最多 30s

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

const QQ_API_BASE = 'https://api.q.qq.com'; // QQ 公众号 OpenAPI
const TG_BOT_API = 'https://api.telegram.org/bot';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// === 推送到 QQ 公众号 ===
// 走"客服消息"接口 (mp_send_text_message / mp_send_news_message)
// 简化版: 仅支持文本 (降低风险), 真实接入需要 access_token 刷新逻辑
async function pushToQQ(title: string, content: string, imageUrl?: string): Promise<{ ok: boolean; msg: string; raw?: any }> {
  const accessToken = process.env.QQ_MP_ACCESS_TOKEN;
  const openId = process.env.QQ_MP_DEFAULT_OPENID; // 公众号默认收件人 (一个测试 openid)
  if (!accessToken || !openId) {
    return { ok: false, msg: 'QQ 公众号未配置 (缺 QQ_MP_ACCESS_TOKEN / QQ_MP_DEFAULT_OPENID)' };
  }
  // 文本消息
  const url = `${QQ_API_BASE}/api/json/qqaibot/message/keyword/reply?access_token=${accessToken}`;
  const body = {
    openid: openId,
    content: `${title}\n\n${content}`,
  };
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const j: any = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ret === 0, msg: j.errMsg || j.msg || 'OK', raw: j };
  } catch (e: any) {
    return { ok: false, msg: 'QQ 推送失败: ' + e.message };
  }
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
    SELECT id, resource_id, channels, qq_ok, tg_ok, content, error, published_by, created_at
    FROM xx_publish_log
    ORDER BY created_at DESC LIMIT 50
  ` as any[];
  return NextResponse.json({ ok: true, items: r, count: r.length });
}

// POST 推双发
// body: { resource_id, channels: ['qq', 'tg'], content?, image_url? }
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

  const sql = neon(process.env.DATABASE_URL || '');
  const rs = await sql`SELECT id, name, description, poster_url FROM xx_resources WHERE id = ${resourceId} LIMIT 1` as any[];
  if (!rs[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  const r = rs[0];

  // 组装发布内容
  const title = `🎬 ${r.name}`;
  const content = customContent || `${r.description || '泽泽妈妈资源'}\n\n👉 查看详情: https://zzmm-search.cc.cd/resources/${r.id}`;
  const img = imageUrl || r.poster_url;

  // 并行双发
  const tasks: Promise<{ ch: string; ok: boolean; msg: string }>[] = [];
  if (channels.includes('qq')) tasks.push(pushToQQ(title, content, img).then(x => ({ ch: 'qq', ok: x.ok, msg: x.msg })));
  if (channels.includes('tg')) tasks.push(pushToTG(title, content, img).then(x => ({ ch: 'tg', ok: x.ok, msg: x.msg })));
  const results = await Promise.all(tasks);

  const qqR = results.find(x => x.ch === 'qq');
  const tgR = results.find(x => x.ch === 'tg');
  const qqOk = qqR?.ok || false;
  const tgOk = tgR?.ok || false;
  const errors = results.filter(x => !x.ok).map(x => `[${x.ch}] ${x.msg}`).join('; ');

  // 写日志
  try {
    await sql`
      INSERT INTO xx_publish_log (
        resource_id, channels, qq_ok, tg_ok, content, error, published_by, created_at
      ) VALUES (
        ${resourceId}, ${channels.join(',')}, ${qqOk}, ${tgOk}, ${content.slice(0, 1000)},
        ${errors.slice(0, 500)}, ${userId}, NOW()
      )
    `;
  } catch (e: any) {
    console.error('[publish] log fail:', e.message);
  }

  return NextResponse.json({
    ok: qqOk || tgOk,
    channels: results.map(x => ({ channel: x.ch, ok: x.ok, msg: x.msg })),
    qq_ok: qqOk,
    tg_ok: tgOk,
    message: errors || '发布成功',
  });
}
