// 2026-08-01: lib/time.ts - 统一处理 Neon HTTP 端 timestamptz 缺 tz 标记的 bug
// 背景: Neon serverless 通过 HTTP endpoint 返 timestamptz 时无 tz 标记 (e.g. "2026-08-01 16:27:16")
//   JS `new Date("2026-08-01 16:27:16")` 按本地时区 (CST) 解析 → epoch 少 8 小时
//   JSON.stringify 时再 toISOString() 转 UTC → API 返的 expire_at 跟 DB 实际差 8 小时
// 修法: helper 检测字符串是否含 tz 标记 (Z / +HH:MM), 无则手动加 'Z' 当 UTC

// 2026-08-17 v2 修法: 无 tz 标记当 Asia/Shanghai (CST) wall clock, 不是 UTC
//   根因: Neon server timezone 实际是 Asia/Shanghai, DB timestamp 列存 wall clock CST
//   返 ::text (无 tz) "2026-09-16 17:11:38" 实际是 CST wall clock
//   老逻辑 append 'Z' 当 UTC → toISOString "2026-09-16T17:11:38.000Z" (UTC) → JS 解析成 9-17 01:11 CST
//   新逻辑 append '+08:00' 当 CST → new Date 转 UTC 9-16 09:11 → toISOString "2026-09-16T09:11:38.000Z"
//   → JS 解析成 9-16 17:11 CST (期望)

/**
 * 解析 Neon HTTP 端可能"缺 tz 标记"的时间字符串, 转成 ISO UTC 字符串
 * @param value Date / string / null
 * @returns ISO UTC string (e.g. "2026-08-01T08:27:16.000Z"), null if input null
 */
export function parseNeonTime(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const v = String(value).trim();
  if (!v) return null;
  // 已含 tz 标记 (Z, +08, +0800, -05:30 等) → 直接 parse
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(v)) {
    return new Date(v).toISOString();
  }
  // 无 tz 标记 → 当 Asia/Shanghai (CST) wall clock 处理 (Neon server timezone=Asia/Shanghai)
  return new Date(v + '+08:00').toISOString();
}

/**
 * 判断 Neon HTTP 端"缺 tz 标记"的时间是否还在未来
 * 用法: const active = isFutureTime(user.expire_at)
 */
export function isFutureTime(value: string | Date | null | undefined): boolean {
  if (value == null) return true; // null = 永久
  const iso = parseNeonTime(value);
  if (!iso) return true;
  return new Date(iso).getTime() > Date.now();
}
