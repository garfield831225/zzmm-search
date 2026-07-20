// 2026-07-21: 临时诊断 - 重跑用户上传的 JSON, 只统计不入库 (无副作用)
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import {
  extractLinksFromTgMessage, extractTitleFromTgMessage,
  type TgLink,
} from '@/lib/import-classifier';

export const runtime = 'nodejs';
export const maxDuration = 60;

const NETDISK_SOURCES = new Set(['115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k']);

function classifyNonDisk(link: string): string {
  const l = link.toLowerCase();
  if (l.startsWith('magnet:')) return 'magnet_skip';
  if (l.startsWith('ed2k://')) return 'ed2k_skip';
  if (l.includes('dmhy')) return 'dmhy';
  if (l.includes('1337x')) return '1337x';
  if (l.includes('nyaa')) return 'nyaa';
  if (l.includes('bthd') || l.includes('broadtheater')) return 'bthd';
  if (l.includes('rarbg')) return 'rarbg';
  if (l.includes('thepiratebay') || l.includes('piratebay')) return 'tpb';
  if (l.includes('rutor')) return 'rutor';
  if (l.includes('rutracker')) return 'rutracker';
  if (l.includes('kisssub') || l.includes('kisssub.org')) return 'kisssub';
  if (l.includes('acg.rip') || l.includes('acgnx')) return 'acg_rip';
  if (l.includes('mikan')) return 'mikan';
  if (l.includes('t.me/')) return 'tg_channel';
  if (l.includes('telegram.me')) return 'tg_channel';
  if (l.includes('telegram.org')) return 'tg_web';
  if (l.includes('nodeseek')) return 'nodeseek';
  if (l.includes('hjdns')) return 'hjdns';
  if (l.includes('butter')) return 'butterfly';
  if (l.includes('52pojie')) return '52pojie';
  if (l.includes('ourbits')) return 'ourbits';
  if (l.includes('hdchina')) return 'hdchina';
  if (l.includes('hdsky')) return 'hdsky';
  if (l.includes('lemonhd')) return 'lemonhd';
  if (l.includes('ptchina')) return 'ptchina';
  if (l.includes('bit.ly') || l.includes('t.cn') || l.includes('tinyurl')) return 'short_url';
  if (l.match(/\.(jpg|jpeg|png|gif|webp|mp4)(\?|$)/)) return 'image';
  if (l.includes('youtu') || l.includes('youtube')) return 'youtube';
  return 'other_non_disk';
}

function getAuth(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (!auth) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const body = await req.json();
  const jsonContent = body.jsonContent;
  if (!jsonContent) return NextResponse.json({ error: '需要 jsonContent' }, { status: 400 });

  let data: any;
  try { data = JSON.parse(jsonContent); }
  catch (e: any) { return NextResponse.json({ error: 'JSON 解析失败: ' + e.message }, { status: 400 }); }

  const messages = data.messages || [];
  const byNetdisk: Record<string, number> = {};
  const bySkipped: Record<string, number> = {};
  let noLink = 0;
  let telegraPh = 0;
  let totalLinks = 0;

  for (const msg of messages) {
    const links = extractLinksFromTgMessage(msg) as TgLink[];
    if (links.length === 0) { noLink++; continue; }
    for (const l of links) {
      totalLinks++;
      if (l.type === 'telegra_ph') { telegraPh++; continue; }
      if (NETDISK_SOURCES.has(l.type as any)) {
        byNetdisk[l.type] = (byNetdisk[l.type] || 0) + 1;
      } else {
        const k = classifyNonDisk(l.url);
        bySkipped[k] = (bySkipped[k] || 0) + 1;
      }
    }
  }

  return NextResponse.json({
    total_messages: messages.length,
    no_link_messages: noLink,
    total_links_extracted: totalLinks,
    by_netdisk: byNetdisk,
    by_skipped: bySkipped,
    telegra_ph_links: telegraPh,
    // 业务结论
    summary: {
      netdisk_links: Object.values(byNetdisk).reduce((a, b) => a + b, 0),
      non_disk_links: Object.values(bySkipped).reduce((a, b) => a + b, 0),
      // 按消息估算 (假设每消息平均 1 link)
      netdisk_messages: Object.values(byNetdisk).reduce((a, b) => a + b, 0),
    },
  });
}
