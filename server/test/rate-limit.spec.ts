import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../src/common/api.exception';
import { RateLimiterService } from '../src/common/rate-limit/rate-limit.service';
import type { RateLimitStore } from '../src/common/rate-limit/rate-limit.store';

/** 带窗口语义的内存实现：窗口过期后计数归零，模拟 Redis INCR+EXPIRE。 */
class InMemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, { count: number; expiresAt: number }>();
  now = Date.now;

  async increment(key: string, windowSeconds: number): Promise<number> {
    const t = this.now();
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= t) {
      this.counts.set(key, { count: 1, expiresAt: t + windowSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }
}

describe('RateLimiterService', () => {
  let store: InMemoryRateLimitStore;
  let limiter: RateLimiterService;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    limiter = new RateLimiterService(store);
  });

  it('窗口内未超限放行，第 31 次抛 RATE_LIMITED + 429', async () => {
    for (let i = 0; i < 30; i += 1) {
      await expect(limiter.check('ip:1')).resolves.toBeUndefined();
    }
    await expect(limiter.check('ip:1')).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('不同 key 独立计数', async () => {
    for (let i = 0; i < 30; i += 1) {
      await limiter.check('ip:1');
    }
    await expect(limiter.check('ip:2')).resolves.toBeUndefined();
  });

  it('窗口过期后计数重置，重新放行', async () => {
    let now = 1_000_000;
    store.now = () => now;
    for (let i = 0; i < 30; i += 1) {
      await limiter.check('ip:1');
    }
    await expect(limiter.check('ip:1')).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
    });
    now += 61_000;
    await expect(limiter.check('ip:1')).resolves.toBeUndefined();
  });

  it('自定义窗口与上限生效', async () => {
    const tight = new RateLimiterService(store, { windowSeconds: 10, maxAttempts: 2 });
    await expect(tight.check('ip:1')).resolves.toBeUndefined();
    await expect(tight.check('ip:1')).resolves.toBeUndefined();
    await expect(tight.check('ip:1')).rejects.toMatchObject({
      code: ERROR_CODES.RATE_LIMITED,
    });
  });

  it('超限时抛的是 ApiException（走统一响应包络）', async () => {
    const tight = new RateLimiterService(store, { maxAttempts: 1 });
    await tight.check('ip:1');
    await expect(tight.check('ip:1')).rejects.toBeInstanceOf(ApiException);
  });
});
