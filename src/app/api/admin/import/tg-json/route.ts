// 2026-07-16: VIP/admin 专属 - 直接解析 Telegram Desktop result.json 导入 xx_resources
// 2026-07-16 加 L2 (telegra.ph) 检测: 写入 xx_resources 同时入队 xx_telegram_l3_queue
// 不集成 Python 工具, 不做分享功能
// 业务规则: 导入全部 access_level='vip', pay_type='vip' (basic 用户会被锁)
// 去重: (link, name) 已存在跳过; (telegra_ph_url) 已存在 queue 跳过

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import {
  detectCategoryByTitle, detectSource, detectImportChannel, detectAccessLevel,
  extractLinksFromTgMessage, extractTitleFromTgMessage, extractTagsFromTgMessage,
  extractSizeFromTgMessage, extractPasswordFromUrl,
  type TgLink, type ImportChannel,
} from '@/lib/import-classifier';

export const runtime = 'nodejs';
export const maxDuration = 60;  // Vercel hobby 上限

// 鉴权: VIP + admin 才能用 (basic 看不到入口)
function getAuth(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return { error: '未登录', status: 401 };
  try {
    const payload = jwt.verify(auth.replace('Bearer ', ''), process.env.JWT_SECRET || 'cLWhs2015') as any;
    const group = String(payload.user_group || payload.group || 'user').toLowerCase();
    if (group !== 'vip' && group !== 'admin') {
      return { error: '此功能仅 VIP/admin 可用', status: 403 };
    }
    return { userId: String(payload.id), username: payload.username, group };
  } catch {
    return { error: 'Token 无效', status: 401 };
  }
}

export async function POST(req: NextRequest) {
  const auth = getAuth(req);
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const contentType = req.headers.get('content-type') || '';
  const sql = neon(process.env.DATABASE_URL || '');

  // 1. 接收 multipart 上传 (file) 或 JSON body (jsonContent)
  let jsonText = '';
  let importChannelHint: string = 'tg_baidu';  // 默认 tg_baidu, 用户可指定

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    const channelHint = form.get('channelHint');
    if (channelHint && typeof channelHint === 'string') {
      importChannelHint = channelHint;
    }
    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: '请上传 result.json 文件' }, { status: 400 });
    }
    // Vercel Hobby 4.5MB 上限, 这里设置 50MB (可在 Pro 调更大)
    const MAX_SIZE = 50 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({
        error: `文件太大 (${(file.size / 1024 / 1024).toFixed(1)}MB), Vercel Hobby 上限 50MB. 请用 UI 上的切片按钮先切分`,
        size_mb: file.size / 1024 / 1024,
        hint: '上传时选择"按 5000 条切片"模式, 或本地用 jq ".messages[0:5000]" 拆分',
      }, { status: 413 });
    }
    jsonText = await file.text();
  } else if (contentType.includes('application/json')) {
    const body = await req.json();
    if (body.jsonContent) {
      jsonText = body.jsonContent;
    } else {
      return NextResponse.json({ error: '需要 jsonContent 字段' }, { status: 400 });
    }
    if (body.channelHint) importChannelHint = body.channelHint;
  } else {
    return NextResponse.json({ error: '不支持的 Content-Type, 请用 multipart/form-data 或 application/json' }, { status: 415 });
  }

  if (!jsonText) {
    return NextResponse.json({ error: '文件内容为空' }, { status: 400 });
  }

  // 2. 解析 JSON
  let data: any;
  try {
    data = JSON.parse(jsonText);
  } catch (e: any) {
    return NextResponse.json({ error: 'JSON 解析失败: ' + e.message?.slice(0, 200) }, { status: 400 });
  }

  const messages = data.messages || [];
  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: 'result.json 格式错误, 没有 messages 数组' }, { status: 400 });
  }

  // 3. 检测 import_channel (优先用 hint, 否则按 forward_from/title 推断)
  const channel: ImportChannel = (() => {
    const h = importChannelHint.toLowerCase();
    if (h.includes('quark')) return 'tg_quark';
    if (h.includes('music')) return 'tg_music';
    if (h.includes('zezemom') || h.includes('zzmm')) return 'zezemom_excel';
    return 'tg_baidu';
  })();

  // 2026-07-18: 网盘白名单 - 非网盘链接 (导航站/TG 频道主页) 直接不入库
  const NETDISK_SOURCES = new Set(['115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k']);

  // 4. 遍历 messages, 提取链接 + 分类
  // 2026-07-17 改造: 1 消息 = 1 资源 + N 链接 (主链接入 xx_resources, 副链接入 xx_resource_links)
  // 主链接按 SOURCE_SORT 优先级选 (1=115 优先, 10=磁力最后)
  const candidates: any[] = [];   // L1 直链资源 (待入库, 1条/消息, 包含主链接 + 副链接)
  const l2Candidates: any[] = []; // L2 telegra.ph 链接 (入 xx_resources + xx_telegram_l3_queue, 维持原逻辑)
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let skippedNoLink = 0;
  let skippedNonDisk = 0;

  for (const msg of messages) {
    if (!msg || msg.type !== 'message') continue;
    const title = extractTitleFromTgMessage(msg);
    if (!title) continue;

    const links = extractLinksFromTgMessage(msg);
    if (links.length === 0) {
      skippedNoLink++;
      continue;
    }

    // 分离 L1 (直链) + L2 (telegra.ph)
    // 2026-07-18: 业务规则 - 非网盘链接 (other) 直接不入库
    //   网盘白名单: 115/baidu/quark/aliyun/xunlei/123/uc/tianyi/yidong/magnet/ed2k
    //   telegra_ph 走 L2 队列
    //   other (导航站/TG 频道主页) 跳过
    const l1Links = links.filter(l => {
      if (l.type === 'telegra_ph') return false;
      if (!NETDISK_SOURCES.has(l.type)) {
        skippedNonDisk++;
        return false;
      }
      return true;
    });
    const l2Links = links.filter(l => l.type === 'telegra_ph');

    // 业务规则: 所有 TG 导入 = VIP + pay_type=vip (basic 用户会被锁, VIP 直接开)
    const accessLevel = 'vip';
    const payType = 'vip';
    const tags = extractTagsFromTgMessage(msg);
    const size = extractSizeFromTgMessage(msg);
    const messageId = msg.id ? Number(msg.id) : null;

    // L1: 一条资源 + N 链接
    if (l1Links.length > 0) {
      const primary = l1Links[0];  // 已按 sort 排序, 第一个 = 最高优先级
      const category = detectCategoryByTitle(title, '其他', primary.type);
      // 2026-07-18 业务规则: 不要 other 兜底, 不是网盘直接不入库
      // 之前 source === 'other' ? '115' : source 把 dmhy/导航站全当 115 入库, 全 404
      const primarySource = primary.type;

      candidates.push({
        name: title.slice(0, 200),
        // 主链接 → xx_resources (兼容老字段)
        link: primary.url,
        link_code: primary.password || '',
        source: primarySource,
        category,
        size: size || '',
        tags,
        access_level: accessLevel,
        pay_type: payType,
        import_channel: channel,
        message_id: messageId,
        // 副链接 → xx_resource_links (排除主链接, 避免 UNIQUE 冲突)
        sub_links: l1Links.slice(1).map(l => ({
          source: l.type,
          url: l.url,
          password: l.password || '',
          sort: l.sort,
        })),
        is_multi_link: l1Links.length > 1,
      });

      // 统计: 1 消息算 1 条入库, 但 bySource 累加所有 link
      byCategory[category] = (byCategory[category] || 0) + 1;
      for (const l of l1Links) {
        bySource[l.type] = (bySource[l.type] || 0) + 1;
      }
    }

    // L2: telegra.ph 中间页 → 入 xx_resources (独立记录) + L3 队列
    for (const l2 of l2Links) {
      l2Candidates.push({
        name: title.slice(0, 200),
        link: l2.url,
        source: 'telegra_ph',
        category: detectCategoryByTitle(title, '其他', 'telegra_ph'),
        tags,
        access_level: accessLevel,
        pay_type: payType,
        import_channel: channel,
        message_id: messageId,
      });
      byCategory['telegra_ph'] = (byCategory['telegra_ph'] || 0) + 1;
      bySource['telegra_ph'] = (bySource['telegra_ph'] || 0) + 1;
    }
  }

  // 5. 去重 L1: 资源入 xx_resources (1条/消息), 副链接入 xx_resource_links (N条)
  let l1Inserted = 0;
  let l1Skipped = 0;
  let l1Failed = 0;
  let l1LinksInserted = 0;
  const errors: string[] = [];

  if (candidates.length > 0) {
    // 2026-07-17: 并发 INSERT (50 并发) + before/after SELECT 验证
    // Neon serverless v3 的 RETURNING 不可靠, 不能用 r?.[0]?.id 判定
    // ANY() array literal 对中文/特殊字符转义坏, 改单条 SELECT 50 并发
    const CONCURRENCY = 50;

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);

      // 1. before: 50 并发查 (link, name) 是否存在
      const beforeResults = await Promise.all(chunk.map(async (c) => {
        try {
          const r = await sql`SELECT 1 as hit FROM xx_resources WHERE link = ${c.link} AND name = ${c.name} LIMIT 1` as any[];
          return { key: `${c.link}\u0000${c.name}`, existed: !!(r && r[0]) };
        } catch {
          return { key: `${c.link}\u0000${c.name}`, existed: false };
        }
      }));
      const existedSet = new Set(beforeResults.filter(r => r.existed).map(r => r.key));

      // 2. INSERT (不依赖 RETURNING)
      const insertResults = await Promise.all(chunk.map(async (c) => {
        try {
          await sql`
            INSERT INTO xx_resources (name, link, link_code, source, category, size, tags, access_level, pay_type, import_channel, status, is_multi_link, created_at, updated_at)
            VALUES (${c.name}, ${c.link}, ${c.link_code || ''}, ${c.source}, ${c.category}, ${c.size || ''}, ${c.tags || []}::text[], ${c.access_level}, ${c.pay_type}, ${c.import_channel}, 'active', ${c.is_multi_link || false}, NOW(), NOW())
            ON CONFLICT (link, name) DO NOTHING
          `;
          return { c, ok: true };
        } catch (e: any) {
          return { c, ok: false, e };
        }
      }));

      // 3. after: 50 并发查 id (新插入的)
      const afterResults = await Promise.all(chunk.map(async (c) => {
        try {
          const r = await sql`SELECT id FROM xx_resources WHERE link = ${c.link} AND name = ${c.name} LIMIT 1` as any[];
          return { key: `${c.link}\u0000${c.name}`, id: r?.[0]?.id };
        } catch {
          return { key: `${c.link}\u0000${c.name}`, id: null };
        }
      }));
      const idByKey = new Map<string, number>();
      for (const r of afterResults) {
        if (r.id) idByKey.set(r.key, r.id);
      }

      // 4. 副表 INSERT
      const subLinkPromises: any[] = [];
      for (const ir of insertResults) {
        if (!ir.ok) {
          l1Failed++;
          if (errors.length < 5) errors.push(`L1[${ir.c.name.slice(0, 30)}] ${ir.e?.message?.slice(0, 100)}`);
          continue;
        }
        const key = `${ir.c.link}\u0000${ir.c.name}`;
        const existed = existedSet.has(key);
        const id = idByKey.get(key);
        if (id && !existed) {
          // 真新插入
          l1Inserted++;
          if (ir.c.sub_links && ir.c.sub_links.length > 0) {
            for (const sl of ir.c.sub_links) {
              subLinkPromises.push(
                sql`
                  INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
                  VALUES (${id}, ${sl.source}, ${sl.url}, ${sl.password}, ${sl.sort}, 'active', 'vip')
                  ON CONFLICT (resource_id, source) DO NOTHING
                `.then(() => l1LinksInserted++).catch((e2: any) => {
                  if (errors.length < 5) errors.push(`SubLink[${sl.source}] ${e2.message?.slice(0, 100)}`);
                })
              );
            }
          }
        } else {
          l1Skipped++;  // 已存在
        }
      }

      // 5. 副表并发
      for (let j = 0; j < subLinkPromises.length; j += CONCURRENCY) {
        await Promise.all(subLinkPromises.slice(j, j + CONCURRENCY));
      }
    }
  }

  // 6. L2: telegra.ph 中间页 → INSERT xx_resources + INSERT xx_telegram_l3_queue
  let l2Inserted = 0;
  let l2QueueAdded = 0;
  let l2Skipped = 0;
  let l2Failed = 0;

  if (l2Candidates.length > 0) {
    // 6a. 先批量查重 L2 queue 里已存在的 telegra_ph_url
    const urls = l2Candidates.map(c => c.link);
    const urlList = Array.from(new Set(urls));
    let existingQueue: any[] = [];
    if (urlList.length > 0) {
      try {
        // 一次最多查 200 个, 用 neon query() + ANY($1::text[]) 数组参数
        const CHUNK = 200;
        for (let i = 0; i < urlList.length; i += CHUNK) {
          const slice = urlList.slice(i, i + CHUNK);
          const existing = await (sql as any).query(
            `SELECT telegra_ph_url FROM xx_telegram_l3_queue WHERE telegra_ph_url = ANY($1::text[])`,
            [slice]
          );
          existingQueue = existingQueue.concat(existing || []);
        }
      } catch (e: any) {
        errors.push('L2 queue 查重失败: ' + e.message?.slice(0, 100));
      }
    }
    const existingUrlSet = new Set(existingQueue.map((r: any) => r.telegra_ph_url));

    // 6b. INSERT xx_resources + xx_telegram_l3_queue
    for (const c of l2Candidates) {
      if (existingUrlSet.has(c.link)) {
        l2Skipped++;
        continue;
      }
      try {
        // 先 INSERT xx_resources
        const r1 = await sql`
          INSERT INTO xx_resources (name, link, link_code, source, category, tags, access_level, pay_type, import_channel, status, created_at, updated_at)
          VALUES (${c.name}, ${c.link}, '', ${c.source}, ${c.category}, ${c.tags || []}::text[], ${c.access_level}, ${c.pay_type}, ${c.import_channel}, 'active', NOW(), NOW())
          ON CONFLICT (link, name) DO NOTHING
          RETURNING id
        ` as any[];

        const resourceId = r1?.[0]?.id;

        // 再 INSERT xx_telegram_l3_queue
        try {
          await sql`
            INSERT INTO xx_telegram_l3_queue (source_message_id, parent_resource_id, telegra_ph_url, status, created_at, updated_at)
            VALUES (${c.message_id || null}, ${resourceId || null}, ${c.link}, 'pending', NOW(), NOW())
            ON CONFLICT (telegra_ph_url) DO NOTHING
          `;
          l2QueueAdded++;
          existingUrlSet.add(c.link);
          if (resourceId) l2Inserted++;
        } catch (qErr: any) {
          // queue 失败但 resource 已入, 不阻塞 (后续可以补)
          if (resourceId) l2Inserted++;
          errors.push(`L2 queue[${c.name.slice(0, 30)}] ${qErr.message?.slice(0, 100)}`);
        }
      } catch (e: any) {
        l2Failed++;
        if (errors.length < 5) errors.push(`L2[${c.name.slice(0, 30)}] ${e.message?.slice(0, 100)}`);
      }
    }
  }

  return NextResponse.json({
    success: true,
    channel: importChannelHint,
    summary: {
      total_messages: messages.length,
      skipped_no_link: skippedNoLink,
      skipped_non_disk: skippedNonDisk,
      l1: { candidates: candidates.length, inserted: l1Inserted, skipped: l1Skipped, failed: l1Failed, links_inserted: l1LinksInserted },
      l2: { candidates: l2Candidates.length, inserted: l2Inserted, queue_added: l2QueueAdded, skipped: l2Skipped, failed: l2Failed },
    },
    by_category: byCategory,
    by_source: bySource,
    errors: errors.length > 0 ? errors : undefined,
    user: auth.username,
    group: auth.group,
  });
}
