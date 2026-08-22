import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token：业务侧依赖窄接口，测试注入内存实现。 */
export const RATE_LIMIT_STORE = 'RateLimitStore';

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<number>;
}

@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private client?: Redis;

  /** 懒连接让无 Redis 的测试不碰 socket（与 RedisTokenStore 同款）。 */
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

  /**
   * 固定窗口计数：INCR 原子自增，每次续期窗口。INCR/EXPIRE 两条命令之间
   * 的微小竞态对限流无害（最坏情况窗口多续一秒）。
   */
  async increment(key: string, windowSeconds: number): Promise<number> {
    const count = await this.redis.incr(key);
    await this.redis.expire(key, windowSeconds);
    return count;
  }
}
