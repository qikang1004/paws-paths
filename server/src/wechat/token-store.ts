import { randomUUID } from 'crypto';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/** DI token: business code depends on the narrow interface, and tests can inject an in-memory implementation. */
export const TOKEN_STORE = 'TokenStore';

export interface TokenStore {
  get(key: string): Promise<string | null>;
  setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
  acquireLock(key: string, ttlSeconds: number): Promise<string | null>;
  releaseLock(key: string, ownerToken: string): Promise<void>;
}

@Injectable()
export class RedisTokenStore implements TokenStore, OnModuleDestroy {
  private client?: Redis;

  /** Lazy connection keeps Redis-free tests from opening a socket. */
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
