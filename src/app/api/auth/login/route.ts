import { NextRequest, NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { getClientIp } from '@/lib/rate-limit';
// 2026-10-20 异常用户登录设计: 本地 IP 库替换 ip-api.com (45 req/min 易限流)
//   - node-ip2region 默认 xdb 数据 (5MB, 自带)
//   - 同步 binarySearchSync 几十 ms, 没外部依赖
//   - 兼容 default-import + create() 风格
import nodeIp2Region from 'node-ip2region';

export const dynamic = 'force-dynamic';

const JWT_SECRET = process.env.JWT_SECRET || 'cLWhs2015';

// 2026-08-13: 公共 API (moviezone + 子站) - 加 CORS 头
//   错误格式保持原样 {error: 'string'}, 不破坏 login page 现有行为
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// 2026-10-20: node-ip2region 单例 (lazy init, 多个 search 复用同一 fd, 避免重复 open db)
let _ip2rInstance: any = null;
function getIp2Region() {
  if (!_ip2rInstance) {
    try {
      // @ts-ignore  (CJS default export 形态, 不同 npm 版本有 module.exports vs create 函数)
      const ctor = (nodeIp2Region as any).create || (nodeIp2Region as any).default?.create || nodeIp2Region;
      _ip2rInstance = typeof ctor === 'function' ? ctor() : ctor;
    } catch (e) {
      _ip2rInstance = null;
    }
  }
  return _ip2rInstance;
}

// 2026-10-20: 解析 IP → 省份 (省 level, 用于跨地域检查 + 持久化)
//   - 失败 (IP 段无数据 / 内网) 返 null, caller 自己降级
//   - 内网 / 私有 IP 直接返 null
function parseProvince(ip: string): { country: string | null; province: string | null; city: string | null; isp: string | null } {
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    return { country: null, province: null, city: null, isp: null };
  }
  // 2026-10-21: IPv6 单独处理
  //   - node-ip2region 的 _ip2long 只支持 IPv4 (4 段), IPv6 会抛 'invalid ip'
  //   - 之前的 catch 兜住了不会崩, 但 IPv6 用户永远拿不到省份 → 跨地域锁对他们完全失效
  //   - IPv6 统一按 "无法定位" 处理 (不锁), 避免误伤
  if (ip.includes(':')) {
    return { country: null, province: null, city: null, isp: null };
  }
  try {
    const ip2r = getIp2Region();
    if (!ip2r) return { country: null, province: null, city: null, isp: null };
    const r = ip2r.binarySearchSync(ip) || ip2r.btreeSearchSync?.(ip);
    if (!r || !r.region) return { country: null, province: null, city: null, isp: null };
    // region = '中国|0|广东省|深圳市|阿里云'
    const parts = String(r.region).split('|');
    // 2026-10-21: 省份字段位置修正
    //   ip2region 格式: 国家|区域码|省份|城市|ISP
    //   省级: 广东/北京/上海/重庆/天津 走直辖市, 部分记录是 '中国|0|北京|北京市|联通'
    //   省级单位名要归一化, 否则 '北京' vs '北京市' 会被判成跨省
    const rawProvince = (parts[2] || '').trim();
    const province = normalizeProvince(rawProvince);
    return {
      country: parts[0] || null,
      province: province || null,
      city: parts[3] || null,
      isp: parts[4] || null,
    };
  } catch {
    return { country: null, province: null, city: null, isp: null };
  }
}

// 2026-10-21: 省级行政区名归一化
//   ip2region 返回的省份名不统一: '广东' / '广东省' / '北京' / '北京市' / '内蒙古' / '内蒙古自治区'
//   不归一化的话同一个城市在不同版本 IP 库里名字不同 → 被误判成"跨省" → 正常用户被锁 2h
//   直辖市/自治区/特别行政区统一去掉后缀
const PROVINCE_SUFFIXES = ['省', '市', '自治区', '特别行政区'];
// 自治区/特别行政区的简写别名 (ip2region 返回全称, 但我们对比时用简写)
const PROVINCE_ALIASES: Record<string, string> = {
  '广西壮族': '广西',
  '新疆维吾尔': '新疆',
  '西藏藏族': '西藏',
  '宁夏回族': '宁夏',
  '内蒙古': '内蒙古',
};
function normalizeProvince(raw: string): string {
  if (!raw) return '';
  let p = raw.trim();
  // 去掉后缀 (注意顺序: '特别行政区' 要在 '区' 之前, 但这里只处理完整后缀)
  for (const suf of PROVINCE_SUFFIXES) {
    if (p.endsWith(suf) && p.length > suf.length) {
      p = p.slice(0, p.length - suf.length);
      break;
    }
  }
  // 全称 → 简写 (广西壮族自治区 → 广西)
  if (PROVINCE_ALIASES[p]) p = PROVINCE_ALIASES[p];
  return p;
}

// 2026-10-21: 跨地域锁的"相邻/等价省份"白名单
//   直辖市之间互相切换 (北京→天津) 属正常通勤, 不该锁
//   港澳台/境外 也不该触发
const PROVINCE_EQUIV_GROUPS: string[][] = [
  ['北京', '天津'],
  ['上海', '江苏', '浙江', '安徽'],
  ['重庆', '四川', '贵州', '云南', '陕西', '湖北', '湖南', '广西'],
  ['广东', '福建', '广西', '海南', '江西', '湖南', '湖北', '河南'],
  ['香港', '澳门', '广东'],
  ['台湾', '福建', '广东'],
];

function isSameOrAdjacentProvince(a: string, b: string): boolean {
  if (!a || !b) return true;   // 有一方未知 → 当作不跨地域 (fail-safe, 不锁)
  if (a === b) return true;
  for (const group of PROVINCE_EQUIV_GROUPS) {
    if (group.includes(a) && group.includes(b)) return true;
  }
  return false;
}

// 2026-07-29: 记录登录 IP + 城市识别
// 2026-10-20: 改用 node-ip2region 本地库, 不依赖外部 HTTP
//   - 同步调用 < 50ms
//   - 失败降级: 写 IP, 省份/城市 null
//   - INSERT xx_login_history + UPDATE xx_users (last_login_province/first_login_province/last_login_ip/last_login_city)
async function recordLoginHistory(userId: number, req: NextRequest) {
  const ip = getClientIp(req.headers, 'unknown');
  const userAgent = req.headers.get('user-agent') || '';
  const parsed = parseProvince(ip);

  const sql = neon(process.env.DATABASE_URL || '');
  // 1) 写历史表 (沿用 xx_login_history: city/region/country/isp 字段)
  //    - region 字段以前存省份 (regionName), 现在 province 入 region, city/country/isp 分开存
  try {
    await sql`
      INSERT INTO xx_login_history (user_id, ip, city, region, country, isp, user_agent, login_at)
      VALUES (${userId}, ${ip}, ${parsed.city}, ${parsed.province}, ${parsed.country}, ${parsed.isp}, ${userAgent}, NOW())
    `;
  } catch (e: any) {
    console.error('[login-history] insert failed:', e?.message);
  }
  // 2) 更新 xx_users: last_login_province + 首次省份 COALESCE + last_login_ip + last_login_city
  try {
    await sql`
      UPDATE xx_users
      SET last_login_province = ${parsed.province},
          first_login_province = COALESCE(first_login_province, ${parsed.province}),
          first_login_ip = COALESCE(first_login_ip, ${ip}),
          last_login_ip = ${ip},
          last_login_city = ${parsed.city},
          updated_at = NOW()
      WHERE id = ${userId}
    `;
  } catch (e: any) {
    console.error('[login-history] user update failed:', e?.message);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { username, password, captcha } = await req.json();

    // 验证码校验（可选，跳过也不阻止登录）
//     const storedCaptcha = req.cookies.get('captcha_code')?.value || '';
//     if (captcha && storedCaptcha && captcha.toLowerCase() !== storedCaptcha.toLowerCase()) {
//       return NextResponse.json({ error: '验证码错误' }, { status: 400, headers: CORS_HEADERS });
//     }

    if (!username || !password) {
      return NextResponse.json({ error: '用户名和密码不能为空' }, { status: 400, headers: CORS_HEADERS });
    }

    const sql = neon(process.env.DATABASE_URL || '');

    // 2026-08-17: 加 registration_source 字段, 不然 viewer_apply 用户登入后 JWT 拿不到值, AuthGuard 限制失效
    //   根因: 老 SELECT 没选 registration_source, user.registration_source 为 undefined → 'main' 覆盖
    //   导致 viewer 升 vip 后不受限制 (AuthGuard 看不到 viewer_apply 标志)
    // 2026-10-20: 加 first_login_province + locked_until + lock_reason, 用于跨地域检查 + 锁定状态
    const rows = await sql`
      SELECT id, username, password_hash, user_group, registration_source, expire_at, status,
             first_login_province, locked_until, lock_reason
      FROM xx_users WHERE username = ${username} LIMIT 1
    ` as any[];
    const users = rows as any[];

    if (!users.length) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401, headers: CORS_HEADERS });
    }

    const user = users[0];
    // 2026-08-16 viewer-role: pending 用户 (viewer 待审) 返 pending 标识, 前端跳 /pending-approval
    //   不设 cookie, 不发 token, 严格隔离主站
    if (user.status === 'pending') {
      return NextResponse.json({
        pending: true,
        user: { id: user.id, username: user.username, user_group: user.user_group, status: user.status, created_at: user.created_at || null },
        message: '账号待审核，请等待管理员处理',
      }, { status: 200, headers: CORS_HEADERS });
    }
    if (user.status !== 'active') {
      return NextResponse.json({ error: '账号已被禁用' }, { status: 403, headers: CORS_HEADERS });
    }

    // 2026-10-20: locked_until 拦截 → 在密码验证前先挡
    //   - 中间件会再检查 (双重防御), 这里也快速返错减少 CPU 浪费
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      const remainingSec = Math.max(0, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 1000));
      return NextResponse.json({
        error: 'account_locked',
        message: '账号已被临时锁定, 请稍后再试',
        reason: user.lock_reason || 'manual_ban',
        seconds: remainingSec,
      }, { status: 423, headers: CORS_HEADERS });
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401, headers: CORS_HEADERS });
    }

    // 2026-10-20 跨地域检查: 比较当前省份 vs 首次省份 (user.first_login_province)
    // 2026-10-21 修正 (用户铁律: 正常登录逻辑不能被误伤):
    //   1. admin 完全豁免 (admin 账号不能被任何自动机制锁, 用户拍板)
    //   2. 相邻/等价省份不锁 (北京→天津, 上海→江苏 等通勤场景)
    //   3. 省份名归一化后再比 ('广东' vs '广东省')
    //   4. 24h 冷却: 同一用户 24h 内最多触发一次跨地域锁, 防止反复锁死正常用户
    //   5. 首次省份为空 → 只记录不锁 (recordLoginHistory 异步写, 可能还没落库)
    const ip = getClientIp(req.headers, 'unknown');
    const parsed = parseProvince(ip);
    const isAdmin = user.user_group === 'admin';
    const provinceChanged = !!(
      user.first_login_province &&
      parsed.province &&
      !isSameOrAdjacentProvince(normalizeProvince(user.first_login_province), parsed.province)
    );
    if (provinceChanged && !isAdmin) {
      // 2026-10-21: 24h 冷却检查 — 避免一次误判后用户反复被锁
      //   查 xx_login_history 最近 24h 有没有 cross_region 相关的锁定记录
      let recentCrossLock = false;
      try {
        const h = await sql`
          SELECT count(1) FROM xx_login_history
          WHERE user_id = ${user.id} AND login_at > NOW() - INTERVAL '24 hours'
        ` as any[];
        // 用"最近 24h 登录次数"做代理判断: 若 24h 内已有多次登录 (说明用户是正常在用),
        // 第一次跨地域只警告不锁, 只有"长期不登录 + 突然异地"才锁
        const recentLogins = Number(h[0]?.count || 0);
        // 24h 内登录 > 1 次 = 活跃用户, 跨地域大概率是移动网络漂移 → 不锁
        recentCrossLock = recentLogins > 1;
      } catch { /* 查不到就按不锁处理, fail-safe */ }

      if (!recentCrossLock) {
        // 跨地域: 写锁定 + 更新 last_login_province + 拒登
        try {
          await sql`
            UPDATE xx_users
            SET locked_until = NOW() + INTERVAL '2 hours',
                lock_reason = 'cross_region',
                last_login_province = ${parsed.province},
                updated_at = NOW()
            WHERE id = ${user.id}
          `;
        } catch {}
        return NextResponse.json({
          error: 'cross_region_locked',
          message: `检测到跨地域登录 (${user.first_login_province} → ${parsed.province}), 账号已被临时锁定 2 小时`,
          reason: 'cross_region',
          seconds: 7200,
        }, { status: 423, headers: CORS_HEADERS });
      }
      // 2026-10-21: 24h 内有多次登录 = 活跃用户 → 判定为移动网络漂移, 不锁, 直接放行
      //   (只更新 last_login_province, 让首次省份保持不变)
      try {
        await sql`UPDATE xx_users SET last_login_province = ${parsed.province}, updated_at = NOW() WHERE id = ${user.id}`;
      } catch {}
    }

    // 2026-10-21: 未触发跨地域锁时, 同步补写 first_login_province
    //   原因: 原来只在 recordLoginHistory (异步 fire-and-forget) 里写
    //         → 首次登录后如果那次异步写失败 (DB 抖动), first_login_province 永远为 null
    //         → 跨地域锁对该用户永久失效 (静默失效, 最难发现)
    //   现在: 同步路径 + 异步路径都写, 用 COALESCE 保证"首次省份"不会被后续登录覆盖
    if (parsed.province) {
      try {
        await sql`
          UPDATE xx_users
          SET first_login_province = COALESCE(first_login_province, ${parsed.province}),
              first_login_ip = COALESCE(first_login_ip, ${ip}),
              last_login_province = ${parsed.province},
              updated_at = NOW()
          WHERE id = ${user.id}
        `;
      } catch (e: any) {
        console.error('[login] province write failed:', e?.message);
      }
    }

    // 更新最后登录时间 (同步, 单点登录挤下线依赖此时间戳)
    // 2026-07-29: 同步更新, 失败抛错, 不静默吞错 (last_login 没更新 = 旧 token 立刻失效)
    await sql`UPDATE xx_users SET last_login = NOW(), updated_at = NOW() WHERE id = ${user.id}`;

    // 2026-10-20: 写省份 + 历史 (异步, 失败不影响登录流程)
    recordLoginHistory(user.id, req).catch((e) => console.error('[login-history]', e.message));

    const token = jwt.sign(
      { id: user.id, username: user.username, group: user.user_group, registration_source: user.registration_source || 'main' },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    // 设置 HTTP-only cookie（供 middleware 读取）
    // 2026-08-08: 加 domain='.zzmm-search.uk' 让 lovemovie.zzmm-search.uk 子域名也能读到
    // (server.py 8688 在子域名下做鉴权, 必须共享 cookie)
    const cookieStore = await cookies();
    cookieStore.set('zzmm_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
      domain: '.zzmm-search.uk',
    });

    return NextResponse.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        group: user.user_group,
        expire_at: user.expire_at,
        registration_source: user.registration_source || 'main',  // 2026-08-17: viewer_locked 检查
      },
    }, { headers: CORS_HEADERS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers: CORS_HEADERS });
  }
}
