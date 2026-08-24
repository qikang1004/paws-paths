import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  REDIS_OP_TIMEOUT_MS,
  closeRedisClient,
  createRedisClient,
  withTimeout,
} from '../redis-client';

/** DI token：业务侧依赖窄接口，测试注入内存实现。 */
export const RATE_LIMIT_STORE = 'RateLimitStore';

export { REDIS_OP_TIMEOUT_MS };

export interface RateLimitStore {
  increment(key: string, windowSeconds: number): Promise<number>;
}

@Injectable()
export class RedisRateLimitStore implements RateLimitStore, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimitStore.name);
  private client?: Redis;

  /** 懒连接让无 Redis 的测试不碰 socket（与 RedisTokenStore 同款）。 */
  private get redis(): Redis {
    if (!this.client) this.client = createRedisClient();
    return this.client;
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await closeRedisClient(client);
  }

  /**
   * 固定窗口计数：INCR 原子自增，每次续期窗口。INCR/EXPIRE 两条命令之间
   * 的微小竞态对限流无害（最坏情况窗口多续一秒）。
   *
   * Redis 不可用时降级放行（返回 0，限流器视为未超限）并写 ERROR 日志。
   * 取舍：登录可用性优先于限流保护 —— 代价是宕机窗口内登录端点无暴力破解
   * 防护，靠日志告警补偿。决策记录见 docs/superpowers/phase1-notes.md。
   */
  async increment(key: string, windowSeconds: number): Promise<number> {
    try {
      return await withTimeout(
        (async () => {
          const count = await this.redis.incr(key);
          await this.redis.expire(key, windowSeconds);
          return count;
        })(),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `限流存储不可用，本次放行（登录端点暂时无限流保护）: ${reason}`,
      );
      return 0;
    }
  }
}
