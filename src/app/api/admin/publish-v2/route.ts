// /api/admin/publish - 对外发布双发 (TG + QQ 群)
// v2.1.4: QQ 走 go-cqhttp 框架, 跑在 NAS 58080 端口
// v2.1.3 锁版是 TG, v2.1.4 加 QQ 群机器人
// POST: { resource_id, channels: ['qq', 'tg'], content?, image_url?, qq_group_id? }
import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';
const TG_BOT_API = 'https://api.telegram.org/bot';
// go-cqhttp 部署在 NAS, 走 HTTP API 调群消息
const GOCQ_URL = process.env.GOCQ_URL || 'http://192.168.1.100:58080';

function adminOnly(authHeader: string | null) {
  if (!authHeader?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(authHeader.replace('Bearer ', ''), JWT_SECRET) as any;
    if (payload.group !== 'admin') return { error: '权限不足', status: 403 };
    return { payload };
  } catch { return { error: 'Token 无效', status: 401 }; }
}

// === 推送到 QQ 群 (go-cqhttp) ===
// 端点: POST /send_group_msg
// body: { group_id, message: [{ type: 'text', data: { text } }, { type: 'image', data: { file } }] }
async function pushToQQGroup(title: string, content: string, groupId: string, imageUrl?: string): Promise<{ ok: boolean; msg: string; raw?: any }> {
  if (!groupId) return { ok: false, msg: '缺 qq_group_id' };
  const messageSeg = [];
  messageSeg.push({ type: 'text', data: { text: `${title}\n\n${content}` } });
  if (imageUrl) {
    // go-cqhttp 支持 base64 / url / file, 直接传 url (但要公网可访问)
    messageSeg.push({ type: 'image', data: { file: imageUrl } });
  }
  try {
    const r = await fetch(`${GOCQ_URL}/send_group_msg`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: Number(groupId) || groupId, message: messageSeg }),
      signal: AbortSignal.timeout(25000),
    });
    const j: any = await r.json().catch(() => ({}));
    // go-cqhttp 响应: { retcode, data: { message_id }, msg }
    const ok = j.retcode === 0 || j.status === 'ok';
    return { ok, msg: j.msg || j.message || (ok ? 'OK' : 'send_group_msg 失败'), raw: j };
  } catch (e: any) {
    return { ok: false, msg: 'go-cqhttp 不可达: ' + e.message };
  }
}

// === 推送到 TG 频道 ===
async function pushToTG(title: string, content: string, imageUrl?: string): Promise<{ ok: boolean; msg: string; raw?: any }> {
  const botToken = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHANNEL_CHAT_ID;
  if (!botToken || !chatId) return { ok: false, msg: 'TG 频道未配置 (缺 TG_BOT_TOKEN / TG_CHANNEL_CHAT_ID)' };
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
export async function GET(req: NextRequest) {
  // 支持 GET 触发 publish (绕过 Vercel POST cache)
  // GET ?publish=1&resource_id=X&channels=tg
  if (req.nextUrl.searchParams.get('publish') === '1') {
    return handlePublish(req, {
      resource_id: Number(req.nextUrl.searchParams.get('resource_id')),
      channels: (req.nextUrl.searchParams.get('channels') || 'tg').split(','),
      content: req.nextUrl.searchParams.get('content') || undefined,
    });
  }
  // 查发布历史
  const auth = req.headers.get('authorization');
  const a = adminOnly(auth);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const sql = neon(process.env.DATABASE_URL || '');
  const r = await sql`
    SELECT id, resource_id, channels, qq_ok, tg_ok, content, error, published_by, created_at
    FROM xx_publish_log ORDER BY created_at DESC LIMIT 50
  ` as any[];
  return NextResponse.json({ ok: true, items: r, count: r.length });
}

// POST 推双发
// body: { resource_id, channels: ['qq', 'tg'], qq_group_id?, content?, image_url? }
export async function POST(req: NextRequest) {
  return handlePublish(req);
}

// GET publish via query string (绕过 Vercel POST cache)
// GET ?publish=1&resource_id=X&channels=tg
async function handlePublish(req: NextRequest, bodyOverride?: any) {
  const auth = req.headers.get('authorization');
  const a = adminOnly(auth);
  if (a.error) return NextResponse.json({ error: a.error }, { status: a.status });
  const userId = Number(a.payload.id);

  const body = bodyOverride || await req.json().catch(() => ({}));
  const resourceId = body.resource_id;
  const channels: string[] = Array.isArray(body.channels) ? body.channels : [];
  const customContent = body.content;
  const imageUrl = body.image_url;
  const qqGroupId = String(body.qq_group_id || process.env.QQ_DEFAULT_GROUP_ID || '');
  if (!resourceId) return NextResponse.json({ error: '缺少 resource_id' }, { status: 400 });
  if (!channels.length) return NextResponse.json({ error: '请选择至少一个发布渠道' }, { status: 400 });
  if (channels.includes('qq') && !qqGroupId) {
    return NextResponse.json({ error: '请提供 qq_group_id 或在 env 配 QQ_DEFAULT_GROUP_ID' }, { status: 400 });
  }

  const sql = neon(process.env.DATABASE_URL || '');
  const rs = await sql`SELECT id, name, description, poster_url FROM xx_resources WHERE id = ${resourceId} LIMIT 1` as any[];
  if (!rs[0]) return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  const r = rs[0];

  const title = `🎬 ${r.name}`;
  const content = customContent || `${r.description || '泽泽妈妈资源'}\n\n👉 查看详情: https://zzmm-search.cc.cd/resources/${r.id}`;
  const img = imageUrl || r.poster_url;

  // 并行双发
  const tasks: Promise<{ ch: string; ok: boolean; msg: string }>[] = [];
  if (channels.includes('qq')) tasks.push(pushToQQGroup(title, content, qqGroupId, img).then(x => ({ ch: 'qq', ok: x.ok, msg: x.msg })));
  if (channels.includes('tg')) tasks.push(pushToTG(title, content, img).then(x => ({ ch: 'tg', ok: x.ok, msg: x.msg })));
  const results = await Promise.all(tasks);

  const qqR = results.find(x => x.ch === 'qq');
  const tgR = results.find(x => x.ch === 'tg');
  const qqOk = qqR?.ok || false;
  const tgOk = tgR?.ok || false;
  const errors = results.filter(x => !x.ok).map(x => `[${x.ch}] ${x.msg}`).join('; ');

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
    qq_ok: qqOk, tg_ok: tgOk,
    message: errors || '发布成功',
  });
}
