import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { closeRedisClient, createRedisClient, withTimeout } from '../common/redis-client';

/** DI token：POI 缓存。测试注入内存实现。 */
export const POI_CACHE = 'PoiCache';

export interface PoiCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Redis 缓存，懒连接（与 RedisRateLimitStore 同款）。无 Redis / 连接失败时
 * get 返回 null、set 静默 no-op —— POI 代理的降级链不因缓存故障而断裂。
 *
 * 连接参数走 createRedisClient：默认的 20 次重试会让「不阻断主链路」变成
 * 阻断 10.7 秒，见 common/redis-client.ts 的实测数据。
 */
@Injectable()
export class RedisPoiCache implements PoiCache, OnModuleDestroy {
  private readonly logger = new Logger(RedisPoiCache.name);
  private client?: Redis;

  private get redis(): Redis {
    if (!this.client) this.client = createRedisClient();
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await closeRedisClient(client);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await withTimeout(this.redis.get(key));
    } catch (err) {
      // 缓存读不到就当未命中，回源即可；用 warn 是因为这不影响正确性。
      this.logger.warn(`POI 缓存读取失败，回源: ${reason(err)}`);
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await withTimeout(this.redis.set(key, value, 'EX', ttlSeconds));
    } catch (err) {
      // no-op：缓存不可用不阻断主链路
      this.logger.warn(`POI 缓存写入失败，跳过: ${reason(err)}`);
    }
  }
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
