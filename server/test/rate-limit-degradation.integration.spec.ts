import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import {
  REDIS_OP_TIMEOUT_MS,
  RedisRateLimitStore,
} from '../src/common/rate-limit/rate-limit.store';

/**
 * 限流降级的真实 Redis 验证。单元测试用替身，证明不了 ioredis 的重试/超时
 * 参数真的把宕机耗时压住了 —— 那是这个文件存在的唯一理由。
 *
 * 跑法（先起 Redis）：
 *   docker run -d -p 6379:6379 redis:7-alpine
 *   REDIS_INTEGRATION=1 npx jest test/rate-limit-degradation.integration.spec.ts
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const REDIS_INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(
  process.env.REDIS_INTEGRATION ?? '',
);

if (!REDIS_INTEGRATION_ENABLED) {
  console.warn(
    '[skip] 限流降级集成测试：设 REDIS_INTEGRATION=1 且起真 Redis 后才会运行。',
  );
}

const describeRedis = REDIS_INTEGRATION_ENABLED ? describe : describe.skip;

/** 指向一个必然没人监听的端口，模拟 Redis 宕机。 */
const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';

/** REDIS_URL 是从进程环境读的，只能靠改 env 来切换目标。 */
function storeAgainst(url: string): RedisRateLimitStore {
  const saved = process.env.REDIS_URL;
  process.env.REDIS_URL = url;
  try {
    const store = new RedisRateLimitStore();
    // 触发懒连接 getter，让客户端在当前 env 下建好
    void (store as unknown as { redis: Redis }).redis;
    return store;
  } finally {
    if (saved === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = saved;
  }
}

describeRedis('限流降级 真实 Redis 集成测试', () => {
  const prefix = `test:rate-limit:${randomUUID()}:`;
  let cleanup: Redis;

  beforeAll(() => {
    cleanup = new Redis(REDIS_URL, { lazyConnect: true });
  });

  afterAll(async () => {
    const keys = await cleanup.keys(`${prefix}*`);
    if (keys.length > 0) await cleanup.del(...keys);
    // disconnect 而非 quit：懒连接客户端在 -t 过滤下可能从未连上，
    // 那时 quit() 不会解析，会把 jest 卡在退出前（同 token-store 集成测试）。
    cleanup.disconnect();
  });

  it('健康 Redis：计数真实累加，窗口 TTL 落到键上', async () => {
    const store = storeAgainst(REDIS_URL);
    const key = `${prefix}healthy`;
    try {
      expect(await store.increment(key, 60)).toBe(1);
      expect(await store.increment(key, 60)).toBe(2);
      expect(await store.increment(key, 60)).toBe(3);

      const ttl = await cleanup.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    } finally {
      await store.onModuleDestroy();
    }
  });

  it('健康 Redis 不会误触降级 —— 计数必须是真的，不能是 0', async () => {
    // 这条防的是最危险的回归：参数配错导致命令在建连前就失败，
    // 于是限流器永远收到 0，静默失效。
    const store = storeAgainst(REDIS_URL);
    const key = `${prefix}no-false-degrade`;
    try {
      const counts: number[] = [];
      for (let i = 0; i < 5; i += 1) counts.push(await store.increment(key, 60));
      expect(counts).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await store.onModuleDestroy();
    }
  });

  it('Redis 宕机：降级放行返回 0，且耗时在硬超时以内', async () => {
    const store = storeAgainst(DEAD_REDIS_URL);
    try {
      for (let i = 0; i < 3; i += 1) {
        const started = Date.now();
        await expect(store.increment(`${prefix}dead`, 60)).resolves.toBe(0);
        // 默认参数下这里是 10.7s；收紧后必须落在硬超时内（留一点调度余量）
        expect(Date.now() - started).toBeLessThan(REDIS_OP_TIMEOUT_MS + 500);
      }
    } finally {
      await store.onModuleDestroy();
    }
  }, 30_000);

  it('Redis 密码错误（WRONGPASS）同样降级放行', async () => {
    const wrong = new URL(REDIS_URL);
    wrong.password = 'definitely-not-the-password';
    const store = storeAgainst(wrong.toString());
    try {
      await expect(store.increment(`${prefix}wrongpass`, 60)).resolves.toBe(0);
    } finally {
      await store.onModuleDestroy();
    }
  }, 30_000);
});
