// src/lib/rate-limit.ts — 简易 IP 限流 (进程内 LRU 桶)
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitOptions {
  /** 窗口内最大次数 */
  limit: number;
  /** 窗口时长 (ms) */
  windowMs: number;
}

/**
 * 限流
 * @param key  限流 key (通常拼 IP + 路径)
 * @param opts 限制配置
 * @returns { allowed, remaining, resetIn }  resetIn 毫秒
 */
export function rateLimit(key: string, opts: RateLimitOptions): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, resetIn: opts.windowMs };
  }
  if (bucket.count >= opts.limit) {
    return { allowed: false, remaining: 0, resetIn: bucket.resetAt - now };
  }
  bucket.count++;
  return { allowed: true, remaining: opts.limit - bucket.count, resetIn: bucket.resetAt - now };
}

export function getClientIp(headers: Headers, fallback: string = 'unknown'): string {
  // 优先 Vercel 提供的 IP
  return headers.get('x-forwarded-for')?.split(',')[0].trim()
      || headers.get('x-real-ip')
      || headers.get('x-vercel-forwarded-for')?.split(',')[0].trim()
      || fallback;
}

// 清理过期桶 (每 5 分钟跑一次, 防止内存涨)
setInterval(() => {
  const now = Date.now();
  buckets.forEach((v, k) => {
    if (v.resetAt < now) buckets.delete(k);
  });
}, 5 * 60 * 1000).unref?.();
