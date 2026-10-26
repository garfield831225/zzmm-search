// 2026-07-16: VIP/admin 专属 - 直接解析 Telegram Desktop result.json 导入 xx_resources
// 2026-07-16 加 L2 (telegra.ph) 检测: 写入 xx_resources 同时入队 xx_telegram_l3_queue
// 不集成 Python 工具, 不做分享功能
// 业务规则: 导入全部 access_level='vip', pay_type='vip' (basic 用户会被锁)
// 去重: (link, name) 已存在跳过; (telegra_ph_url) 已存在 queue 跳过

import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import jwt from 'jsonwebtoken';
import { inferDocSheetFromCategory } from '@/lib/sheet-mapping';
import {
  detectCategoryByTitle, detectSource, detectImportChannel, detectAccessLevel,
  extractLinksFromTgMessage, extractTitleFromTgMessage, extractTagsFromTgMessage,
  extractSizeFromTgMessage, extractPasswordFromUrl,
  type TgLink, type ImportChannel,
} from '@/lib/import-classifier';

export const runtime = 'nodejs';
// 2026-07-26: NAS 部署 maxDuration 没 Vercel 60s 限制, 587 条 INSERT 50 并发要 60-90s, 调大到 300
export const maxDuration = 300;

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
  // 2026-07-22: 加 6 个新网盘 (1f78159 加的 aliyun/xunlei/123/uc/tianyi/yidong)
  // 之前只支持 4 个老 channel, 6 个新 channel 全 fallback 到 tg_baidu
  // 2026-07-24: hint 为空时, sample 前 50 个 message 自动判 channel (防止默认 tg_baidu 把阿里数据全标错)
  const channel: ImportChannel = (() => {
    const h = importChannelHint.toLowerCase();
    if (h) {
      if (h.includes('zezemom') || h.includes('zzmm')) return 'zezemom_excel';
      if (h.includes('aliyun') || h.includes('alipan')) return 'tg_aliyun';
      if (h.includes('xunlei')) return 'tg_xunlei';
      if (h.includes('123')) return 'tg_123';
      if (h.includes('uc')) return 'tg_uc';
      if (h.includes('tianyi') || h.includes('189')) return 'tg_tianyi';
      if (h.includes('yidong') || h.includes('139')) return 'tg_yidong';
      if (h.includes('quark')) return 'tg_quark';
  if (h.includes('guangya')) return 'tg_guangya';
      if (h.includes('music')) return 'tg_music';
      if (h.includes('baidu')) return 'tg_baidu';
    }
    // 智能识别: sample 前 50 个 message, 按 source 出现频次自动判
    const sample = messages.slice(0, 50);
    const sourceCount: Record<string, number> = {};
    for (const msg of sample) {
      if (!msg || msg.type !== 'message') continue;
      const links = extractLinksFromTgMessage(msg);
      for (const l of links) {
        if (l.type) sourceCount[l.type] = (sourceCount[l.type] || 0) + 1;
      }
    }
    if (Object.keys(sourceCount).length === 0) return 'tg_baidu';
    // 找出现最多的 source
    const dominant = Object.entries(sourceCount).sort((a, b) => b[1] - a[1])[0][0];
    if (dominant === 'aliyun') return 'tg_aliyun';
    if (dominant === 'quark') return 'tg_quark';
    if (dominant === 'guangya') return 'tg_guangya';
    if (dominant === 'baidu') return 'tg_baidu';
    if (dominant === 'magnet' || dominant === 'ed2k') return 'tg_magnet';
    if (dominant === '123') return 'tg_123';
    if (dominant === 'uc') return 'tg_uc';
    if (dominant === 'tianyi') return 'tg_tianyi';
    if (dominant === 'yidong') return 'tg_yidong';
    if (dominant === 'xunlei') return 'tg_xunlei';
    if (dominant === '115') return 'tg_115';
    return 'tg_baidu';
  })();

  // 2026-07-18: 网盘白名单 - 非网盘链接 (导航站/TG 频道主页) 直接不入库
  const NETDISK_SOURCES = new Set(['115', 'baidu', 'quark', 'aliyun', 'xunlei', '123', 'uc', 'tianyi', 'yidong', 'magnet', 'ed2k']);

  // 2026-07-21: 细分识别 - 把 "other" 进一步归类, 让用户知道跳过的具体是什么
  // 不入库但统计, 让用户区分"导航站链接"vs"TG 频道主页"vs"论坛链接"
  function classifyNonDisk(link: string): string {
    const l = link.toLowerCase();
    if (l.startsWith('magnet:')) return 'magnet_skip'; // 已经是 magnet 兜底, 不应到这里
    if (l.startsWith('ed2k://')) return 'ed2k_skip';
    // 导航站 (BT 资源索引站, 几乎都失效)
    if (l.includes('dmhy')) return 'dmhy';          // 动漫花园
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
    // TG 频道/群组主页
    if (l.includes('t.me/')) return 'tg_channel';
    if (l.includes('telegram.me')) return 'tg_channel';
    if (l.includes('telegram.org')) return 'tg_web';
    // 论坛
    if (l.includes('nodeseek')) return 'nodeseek';
    if (l.includes('hjdns')) return 'hjdns';
    if (l.includes('butter')) return 'butterfly';
    if (l.includes('52pojie')) return '52pojie';
    if (l.includes('ourbits')) return 'ourbits';
    if (l.includes('hdchina')) return 'hdchina';
    if (l.includes('hdsky')) return 'hdsky';
    if (l.includes('lemonhd')) return 'lemonhd';
    if (l.includes('ptchina')) return 'ptchina';
    // 短链 (跳转类)
    if (l.includes('bit.ly') || l.includes('t.cn') || l.includes('tinyurl')) return 'short_url';
    // 图片/外链
    if (l.match(/\.(jpg|jpeg|png|gif|webp|mp4)(\?|$)/)) return 'image';
    if (l.includes('youtu') || l.includes('youtube')) return 'youtube';
    // 内部 unknown 但实际上可能有效
    return 'other_non_disk';
  }

  // 4. 遍历 messages, 提取链接 + 分类
  // 2026-07-17 改造: 1 消息 = 1 资源 + N 链接 (主链接入 xx_resources, 副链接入 xx_resource_links)
  // 主链接按 SOURCE_SORT 优先级选 (1=115 优先, 10=磁力最后)
  const candidates: any[] = [];   // L1 直链资源 (待入库, 1条/消息, 包含主链接 + 副链接)
  const l2Candidates: any[] = []; // L2 telegra.ph 链接 (入 xx_resources + xx_telegram_l3_queue, 维持原逻辑)
  const byCategory: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  // 2026-07-21: 细分统计 - 跳过的"非网盘"按类型计数
  const bySkippedSource: Record<string, number> = {};
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
        // 2026-07-21: 细分识别, 让用户知道跳过的具体类型
        const kind = classifyNonDisk(l.url);
        bySkippedSource[kind] = (bySkippedSource[kind] || 0) + 1;
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
  let l1Inserted = 0;   // 新增 (真 INSERT)
  let l1Updated = 0;    // 更新 (同 link 已存在, DO UPDATE)
  let l1Skipped = 0;
  let l1Failed = 0;
  let l1LinksInserted = 0;
  const errors: string[] = [];

  if (candidates.length > 0) {
    // 2026-07-17: 并发 INSERT (50 并发) + before/after SELECT 验证
    // Neon serverless v3 的 RETURNING 不可靠, 不能用 r?.[0]?.id 判定
    // ANY() array literal 对中文/特殊字符转义坏, 改单条 SELECT 50 并发
    // 2026-07-26 改: 50 并发 → 5 并发 (Neon 免费版 RPS 限制 5/s, 50 并发排队卡到 100s+)
    // 2026-10-19 改: 1 并发 → 8 并发 (Neon HTTP proxy max=10 够用, 单批 500 candidates × 3 SQL = 1500 SQL 串行太慢)
    //   实测 proxy 10 并发 18ms, 8 并发足够; 单批 500 candidates 走 8 并发 ≈ 60-90s (client abort 180s)
    //   之前 1 并发: 1300 candidates × 3 SQL 串行 = 800s, 必超 180s abort
    //   8 并发: 500 candidates × 3 SQL 并行 = 200 SQL / 8 = 25s, 跟实际 Neon RPS 5-8 匹配
    const CONCURRENCY = 8;

    for (let i = 0; i < candidates.length; i += CONCURRENCY) {
      const chunk = candidates.slice(i, i + CONCURRENCY);

      // 1. before: 并发查 (link, name) 是否存在 + 拿到 id (合并 before/after, 1 次 SELECT 拿所有)
      //   2026-08-12 优化: 之前 2 次 SELECT (before + after), 改 1 次拿 (id, existed)
      const beforeResults = await Promise.all(chunk.map(async (c) => {
        try {
          // 2026-10-26 改: 按 link 查 (不再 link+name) —— 业务去重规则是"同一链接只留一条"
          //   TG 剧集的 name 带集数后缀 (更新至14集/16集/18集...), 同一 link 每集一个 name
          //   → (link,name) 唯一约束拦不住 → 每次导入都新插 (实测库里 2158 组重复 / 17219 条)
          //   现在: link 已存在 → UPDATE 那条 (刷新 name/集数), 不 INSERT 新行
          // 2026-10-26 修: 必须过滤 status —— 软删记录 (status='deleted') 仍占用 (link,name) 唯一约束
          //   查不到 active 的就拿 deleted 的, 后面 DO UPDATE 时把它恢复成 active (内容又有了)
          //   不然: 命中软删记录 → UPDATE 成功但状态还是 deleted → 用户看不到刚导入的资源
          const r = await sql`
            SELECT id, name, status FROM xx_resources
            WHERE link = ${c.link} AND status = 'active'
            ORDER BY id LIMIT 1
          ` as any[];
          let existing = r && r[0];
          if (!existing) {
            // 该 link 没有 active 记录 → 看有没有被软删的 (去重时标记的), 准备复活
            const r2 = await sql`
              SELECT id, name, status FROM xx_resources
              WHERE link = ${c.link} AND status = 'deleted'
              ORDER BY id DESC LIMIT 1
            ` as any[];
            existing = r2 && r2[0];
          }
          // existed: 该 link 已经有记录 (不论 name 是否相同)
          //   软删的 (status='deleted') 也算 —— 复活它比新插一行好 (避免又占一个 (link,name) 槽位)
          const existed = !!existing;
          const wasDeleted = !!existing && existing.status === 'deleted';
          return { key: `${c.link}\u0000${c.name}`, existed, id: existing ? existing.id : null, sameName: !!existing && existing.name === c.name, wasDeleted };
        } catch {
          return { key: `${c.link}\u0000${c.name}`, existed: false, id: null, sameName: false, wasDeleted: false };
        }
      }));
      const existedMap = new Map<string, { existed: boolean; id: number | null }>();
      beforeResults.forEach((r) => {
        existedMap.set(r.key, { existed: r.existed, id: r.id });
      });

      // 2. INSERT + RETURNING id (Neon HTTP proxy 支持 RETURNING, rows.length = 真插入+DO UPDATE 行数)
      // 2026-10-18 改: 之前只数 existed=false 的真新插入, DO UPDATE 走的 existed=true 路径算 skipped
      //   结果: tg_baidu DB 已有 84529 条, 用户 1472 messages 几乎全 DO UPDATE, 显示 inserted=0 用户误以为"没入库"
      //   修: RETURNING id rows 长度就是真正受影响行数 (INSERT 新增 + DO UPDATE 触发)
      // 2.1 同 chunk 内按 link 分组 —— 同一 link 只允许一次 INSERT
      //   2026-10-26: before 查询是批量并发跑完的, 同一 chunk 里两个"库里还没有的同 link"候选
      //   都查不到 → 都走 INSERT → 又造出重复 (TG 剧集同一条 115 链接发两条: 更新至14集 / 更新至16集)
      //   做法: 每个 link 的第一个候选当 primary (负责 INSERT), 其余当 secondary (UPDATE primary 那条)
      const linkOwner = new Map<string, number>();
      const primaryIdx: number[] = [];
      const secondaryIdx: number[] = [];
      chunk.forEach((c, i) => {
        // link 为空 (理论上不该进 candidates, 这里兜底) → 不参与分组, 各自独立处理
        if (!c.link) { primaryIdx.push(i); return; }
        if (linkOwner.has(c.link)) secondaryIdx.push(i);
        else { linkOwner.set(c.link, i); primaryIdx.push(i); }
      });

      const runOne = async (c: any, forcedId: number | null) => {
        try {
          const docSheet = c.doc_sheet || inferDocSheetFromCategory(c.category);
          // 2026-10-26 改: 按 link 去重 —— link 已存在 → 显式 UPDATE 那条, 完全不走 INSERT
          //   为什么不能只靠 ON CONFLICT (link,name):
          //     ON CONFLICT 只在 (link,name) 完全相同时触发
          //     TG 集数更新 → name 变了 (更新至14集 → 更新至16集) → 走 INSERT 新行 → 重复又产生
          //   所以: before 已按 link 查到 id → 这里直接 UPDATE 那条
          //   forcedId: 同一 chunk 内同 link 的后续候选 → 复用 primary 刚拿到的 id
          const knownId = forcedId ?? existedMap.get(`${c.link}\u0000${c.name}`)?.id ?? null;
          if (knownId) {
            const rUpd = await sql`
              UPDATE xx_resources
              SET name = CASE
                    WHEN import_channel LIKE 'tg_%'
                     AND ${c.name} !~ '^(描述|简介|概要|剧情|介绍|内容|故事|desc|summary)[:：]'
                    THEN ${c.name}
                    ELSE name
                  END,
                  status = CASE
                    WHEN status = 'deleted' AND import_channel LIKE 'tg_%' THEN 'active'
                    ELSE status
                  END,
                  updated_at = NOW()
              WHERE id = ${knownId}
              RETURNING id
            ` as any[];
            return { c, ok: true, id: rUpd?.[0]?.id, affected: (rUpd || []).length, isNew: false };
          }
          // link 完全没有 → INSERT (RETURNING id + xmax 判定新增/更新)
          //   xmax = 0 是 PG 判断"这行是本次 INSERT 的"的标准技巧, 用来区分 新增 vs 更新
          const r = await sql`
            INSERT INTO xx_resources (name, link, link_code, source, category, size, doc_sheet, tags, access_level, pay_type, import_channel, status, is_multi_link, created_at, updated_at)
            VALUES (${c.name}, ${c.link}, ${c.link_code || ''}, ${c.source}, ${c.category}, ${c.size || ''}, ${docSheet}, ${c.tags || []}::text[], ${c.access_level}, ${c.pay_type}, ${c.import_channel}, 'active', ${c.is_multi_link || false}, NOW(), NOW())
            ON CONFLICT (link, name) DO UPDATE SET
              name = CASE
                WHEN xx_resources.import_channel LIKE 'tg_%'
                 AND EXCLUDED.name !~ '^(描述|简介|概要|剧情|介绍|内容|故事|desc|summary)[:：]'
                THEN EXCLUDED.name
                ELSE xx_resources.name
              END,
              -- 2026-10-26: 命中软删记录时恢复成 active (只恢复 TG 来源, 避免复活用户手动删的 zezhe 资源)
              status = CASE
                WHEN xx_resources.status = 'deleted' AND xx_resources.import_channel LIKE 'tg_%' THEN 'active'
                ELSE xx_resources.status
              END,
              updated_at = NOW()
            RETURNING id, (xmax = 0) AS is_new
          ` as any[];
          const isNew = r?.[0]?.is_new === true || r?.[0]?.is_new === 't' || r?.[0]?.is_new === 1;
          return { c, ok: true, id: r?.[0]?.id, affected: (r || []).length, isNew };
        } catch (e: any) {
          // 2026-08-01: log SQL error 到 stderr 方便诊断
          console.error('[tg-json] INSERT failed:', e.message?.slice(0, 200), 'name:', c.name?.slice(0, 30), 'link:', c.link?.slice(0, 60));
          return { c, ok: false, e };
        }
      };

      // Phase 1: primary (每个 link 的第一个候选) 并发处理
      const primaryResults = await Promise.all(primaryIdx.map((i) => runOne(chunk[i], null)));
      // Phase 2: secondary (同 chunk 内同 link 的后续候选) → 复用 primary 的 id 走 UPDATE, 不再 INSERT
      //   TG 消息按时间顺序排列 → 后面的候选集数更新 → 名字最终落在最新那个 ✅
      const chunkLinkId = new Map<string, number>();
      primaryResults.forEach((r, k) => {
        const c = chunk[primaryIdx[k]];
        if (r?.ok && r.id) chunkLinkId.set(c.link, r.id);
      });
      const secondaryResults = await Promise.all(
        secondaryIdx.map((i) => runOne(chunk[i], chunkLinkId.get(chunk[i].link) ?? null))
      );
      const insertResults = [...primaryResults, ...secondaryResults];

      // 3. after: 并发查 id (只查 INSERT 成功的 + 新插入的)
      //   2026-08-12 优化: 只对没拿到 id 的查 (如果 before 找到了 id, INSERT 时 ON CONFLICT 覆盖, id 不变; 如果没找到, INSERT 新增, id 变化)
      //   实际上用 RETURNING id 是最稳的, 但 Neon v3 sql template tag 不支持 RETURNING
      //   所以保留 after SELECT, 但只对没拿 id 的查
      const needAfterLookup = insertResults.filter(ir => {
        if (!ir.ok) return false;
        const m = existedMap.get(`${ir.c.link}\u0000${ir.c.name}`);
        return m && !m.id;  // before 没找到 id 的 (说明是新插入)
      });

      const idByKey = new Map<string, number>();
      existedMap.forEach((m, key) => {
        if (m.id) idByKey.set(key, m.id);
      });

      if (needAfterLookup.length > 0) {
        const afterResults = await Promise.all(needAfterLookup.map(async (ir) => {
          try {
            const r = await sql`SELECT id FROM xx_resources WHERE link = ${ir.c.link} AND name = ${ir.c.name} LIMIT 1` as any[];
            return { key: `${ir.c.link}\u0000${ir.c.name}`, id: r?.[0]?.id };
          } catch {
            return { key: `${ir.c.link}\u0000${ir.c.name}`, id: null };
          }
        }));
        for (const r of afterResults) {
          if (r.id) idByKey.set(r.key, r.id);
        }
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
        const m = existedMap.get(key);
        const existed = m?.existed || false;
        // 2026-10-18 改: 用 RETURNING id 的 affected 计数 (含 DO UPDATE 触发行)
        //   之前: 只数 existed=false (新插入), existed=true (DO UPDATE 触发) 算 skipped
        //   现在: RETURNING id 返回所有受影响行, 不管 INSERT 新增 还是 DO UPDATE 都算 l1Inserted
        //   注意: ON CONFLICT (link, name) DO UPDATE + RETURNING id 一定返 1 id (PG 行为)
        if (ir.id) {
          // 2026-10-26: 区分 真新增 vs 更新 (原来 DO UPDATE 也算 inserted, 显示误导)
          if (ir.isNew === false) l1Updated++;
          else l1Inserted++;
          // 副链接 INSERT (用 ir.id, 不再用 idByKey)
          if (ir.c.sub_links && ir.c.sub_links.length > 0) {
            for (const sl of ir.c.sub_links) {
              subLinkPromises.push(
                sql`
                  INSERT INTO xx_resource_links (resource_id, source, url, password, sort, status, access_level)
                  VALUES (${ir.id}, ${sl.source}, ${sl.url}, ${sl.password}, ${sl.sort}, 'active', 'vip')
                  ON CONFLICT (resource_id, source) DO NOTHING
                `.then(() => l1LinksInserted++).catch((e2: any) => {
                  if (errors.length < 5) errors.push(`SubLink[${sl.source}] ${e2.message?.slice(0, 100)}`);
                })
              );
            }
          }
        } else {
          l1Skipped++;  // 异常: 没有 id
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

  // 2026-07-18: 导入后立刻触发一次匹配 (fire-and-forget), 让新导入的资源能更快有封面
  // 2026-07-18 修: 必须先 INSERT 一条 pending task 到 xx_match_tasks, match-task 端点才会跑
  if (l1Inserted > 0) {
    try {
      // 1. INSERT pending task (覆盖现有 running task 也行, 反正只有最新任务在跑)
      const existing = await sql`SELECT id FROM xx_match_tasks WHERE status IN ('pending', 'running') LIMIT 1` as any[];
      if (!existing[0]) {
        await sql`
          INSERT INTO xx_match_tasks (status, total, matched, nomatch, "offset", batch_size, created_at, updated_at)
          VALUES ('pending', ${l1Inserted}, 0, 0, 0, 200, NOW(), NOW())
        `;
      }
      // 2. Fire-and-forget 触发 match-task 端点
      const cronUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://zzmm-search.cc.cd'}/api/cron/match-task`;
      fetch(cronUrl, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    } catch {}
  }

  return NextResponse.json({
    success: true,
    channel: importChannelHint,
    summary: {
      total_messages: messages.length,
      skipped_no_link: skippedNoLink,
      skipped_non_disk: skippedNonDisk,
      l1: { candidates: candidates.length, inserted: l1Inserted, updated: l1Updated, skipped: l1Skipped, failed: l1Failed, links_inserted: l1LinksInserted },
      l2: { candidates: l2Candidates.length, inserted: l2Inserted, queue_added: l2QueueAdded, skipped: l2Skipped, failed: l2Failed },
    },
    by_category: byCategory,
    by_source: bySource,
    // 2026-07-22: 按网盘类型分类 - 用户要"每个类型的网盘都加一下"
    // 包括 10 种网盘 (115/baidu/quark/aliyun/xunlei/123/uc/tianyi/yidong/magnet/ed2k)
    by_source_disk: (() => {
      const map: Record<string, number> = {};
      for (const m of messages) {
        if (!Array.isArray(m.text)) continue;
        for (const t of m.text) {
          if (typeof t === 'object' && (t.type === 'text_link' || t.type === 'link' || t.type === 'code')) {
            const url = t.href || t.text || '';
            if (url) {
              const src = detectSource(url);
              if (src !== 'other' && src !== 'telegra_ph') {
                map[src] = (map[src] || 0) + 1;
              }
            }
          }
        }
      }
      return map;
    })(),
    // 2026-07-21: 细分"非网盘跳过"按类型 - 导航站/TG频道/短链/图片 各自多少
    by_skipped_source: bySkippedSource,
    errors: errors.length > 0 ? errors : undefined,
    user: auth.username,
    group: auth.group,
  });
}
