import Redis from 'ioredis';
import { env } from '@/lib/env';

class RedisCache {
  private static instance: Redis;
  private static connected = false;

  static getClient(): Redis {
    if (!this.instance) {
      this.instance = new Redis({
        host: env.REDIS_HOST || 'localhost',
        port: parseInt(env.REDIS_PORT || '6379'),
        password: env.REDIS_PASSWORD || undefined,
        tls: env.REDIS_TLS === 'true' ? {} : undefined,
        retryStrategy: (times) => {
          if (times > 3) {
            console.warn('Redis连接失败，禁用缓存层');
            return null;
          }
          return Math.min(times * 200, 2000);
        },
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });

      this.instance.on('error', () => {
        this.connected = false;
      });

      this.instance.on('connect', () => {
        this.connected = true;
      });
    }
    return this.instance;
  }

  static isConnected(): boolean {
    return this.connected;
  }

  // TMDB缓存：7天
  static async getTmdb(tmdbId: string): Promise<any | null> {
    try {
      const client = this.getClient();
      const data = await client.get(`tmdb:${tmdbId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static async setTmdb(tmdbId: string, data: any): Promise<void> {
    try {
      const client = this.getClient();
      await client.setex(`tmdb:${tmdbId}`, 7 * 24 * 3600, JSON.stringify(data));
    } catch {}
  }

  // 搜索结果缓存：10分钟
  static async getSearch(key: string): Promise<any | null> {
    try {
      const client = this.getClient();
      const data = await client.get(`search:${key}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static async setSearch(key: string, data: any): Promise<void> {
    try {
      const client = this.getClient();
      await client.setex(`search:${key}`, 600, JSON.stringify(data));
    } catch {}
  }

  // 链接有效性缓存：24小时
  static async getLinkValid(link: string): Promise<string | null> {
    try {
      const client = this.getClient();
      return await client.get(`link:${this.hashLink(link)}`);
    } catch {
      return null;
    }
  }

  static async setLinkValid(link: string, status: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.setex(`link:${this.hashLink(link)}`, 24 * 3600, status);
    } catch {}
  }

  // 用户会话缓存：24小时
  static async getSession(userId: string): Promise<any | null> {
    try {
      const client = this.getClient();
      const data = await client.get(`session:${userId}`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static async setSession(userId: string, data: any): Promise<void> {
    try {
      const client = this.getClient();
      await client.setex(`session:${userId}`, 24 * 3600, JSON.stringify(data));
    } catch {}
  }

  static async delSession(userId: string): Promise<void> {
    try {
      const client = this.getClient();
      await client.del(`session:${userId}`);
    } catch {}
  }

  // 清理搜索缓存（数据更新时）
  static async clearSearchCache(): Promise<void> {
    try {
      const client = this.getClient();
      const keys = await client.keys('search:*');
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch {}
  }

  // 工具方法
  private static hashLink(link: string): string {
    // 简单hash用于key，避免特殊字符问题
    let hash = 0;
    for (let i = 0; i < link.length; i++) {
      hash = ((hash << 5) - hash) + link.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(36);
  }
}

export default RedisCache;