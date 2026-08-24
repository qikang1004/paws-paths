import { randomUUID } from 'crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type Redis from 'ioredis';
import { closeRedisClient, createRedisClient } from '../common/redis-client';

/** DI token: business code depends on the narrow interface, and tests can inject an in-memory implementation. */
export const TOKEN_STORE = 'TokenStore';

export interface TokenStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
  releaseLock(key: string, ownerToken: string): Promise<void>;
}

/**
 * 刻意不做降级：错误一律上抛。access_token 是单点缓存，缓存故障时若静默返回
 * null，每个请求都会去刷 token，撞微信的调用频率限制并互相顶掉彼此的 token。
 * 连接参数走 createRedisClient，把默认 20 次重试（宕机要 10.7s 才失败）收紧到
 * 亚秒级，见 common/redis-client.ts。
 */
@Injectable()
export class RedisTokenStore implements TokenStore, OnModuleDestroy {
  private client?: Redis;

  /** Lazy connection keeps Redis-free tests from opening a socket. */
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
    return this.redis.get(key);
  }

  async setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', Math.max(ttlSeconds, 1));
  }

  /** Atomic SET NX EX prevents competing service instances from refreshing concurrently. */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    const ownerToken = randomUUID();
    const result = await this.redis.set(key, ownerToken, 'EX', ttlSeconds, 'NX');
    return result === 'OK' ? ownerToken : null;
  }

  async releaseLock(key: string, ownerToken: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
      1,
      key,
      ownerToken,
    );
  }
}
