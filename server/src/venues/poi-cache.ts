import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token：POI 缓存。测试注入内存实现。 */
export const POI_CACHE = 'PoiCache';

export interface PoiCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Redis 缓存，懒连接（与 RedisRateLimitStore 同款）。无 Redis / 连接失败时
 * get 返回 null、set 静默 no-op —— POI 代理的降级链不因缓存故障而断裂。
 */
@Injectable()
export class RedisPoiCache implements PoiCache, OnModuleDestroy {
  private client?: Redis;

  private get redis(): Redis {
    if (!this.client) {
      this.client = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', {
        lazyConnect: true,
      });
    }
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch {
      // no-op：缓存不可用不阻断主链路
    }
  }
}
