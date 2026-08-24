import { Logger } from '@nestjs/common';
import {
  REDIS_OP_TIMEOUT_MS,
  RedisRateLimitStore,
} from '../src/common/rate-limit/rate-limit.store';
import { RateLimiterService } from '../src/common/rate-limit/rate-limit.service';

/**
 * Redis 故障时的限流降级。取舍是「降级放行 + 告警日志」：登录可用性优先，
 * 代价是 Redis 宕机窗口内登录端点没有限流保护。见 phase1-notes.md 的决策记录。
 *
 * 这里不连真 Redis —— 用 storeWith() 注入替身，测的是降级分支本身。
 * 参数组合对真实 Redis 的效果由 rate-limit-degradation.integration.spec.ts 验证。
 */

type FakeRedis = {
  incr: jest.Mock;
  expire: jest.Mock;
  quit: jest.Mock;
  disconnect: jest.Mock;
};

function fakeRedis(overrides: Partial<FakeRedis> = {}): FakeRedis {
  return {
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    quit: jest.fn().mockResolvedValue('OK'),
    disconnect: jest.fn(),
    ...overrides,
  };
}

/** 用注入的替身替换懒连接 getter，避免测试碰 socket。 */
function storeWith(redis: FakeRedis): RedisRateLimitStore {
  const store = new RedisRateLimitStore();
  Object.defineProperty(store, 'redis', { get: () => redis });
  return store;
}

/**
 * onModuleDestroy 读的是私有 client 字段，而 storeWith 只改了 getter。
 * 关闭路径要单独把 client 塞进去。
 */
function storeWithClient(redis: FakeRedis): RedisRateLimitStore {
  const store = new RedisRateLimitStore();
  (store as unknown as { client: unknown }).client = redis;
  return store;
}

describe('RedisRateLimitStore 降级行为', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('Redis 正常时返回真实计数', async () => {
    const redis = fakeRedis({ incr: jest.fn().mockResolvedValue(7) });
    await expect(storeWith(redis).increment('k', 60)).resolves.toBe(7);
    expect(redis.expire).toHaveBeenCalledWith('k', 60);
  });

  it('incr 抛错时降级放行：返回 0 而不是把异常抛给调用方', async () => {
    const redis = fakeRedis({
      incr: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:6379')),
    });
    await expect(storeWith(redis).increment('k', 60)).resolves.toBe(0);
  });

  it('降级时写 ERROR 日志（宕机窗口必须在日志里留痕）', async () => {
    const redis = fakeRedis({ incr: jest.fn().mockRejectedValue(new Error('NOAUTH')) });
    await storeWith(redis).increment('k', 60);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toContain('NOAUTH');
  });

  it('expire 抛错也降级放行（INCR 已成功，不能因续期失败拒登录）', async () => {
    const redis = fakeRedis({
      incr: jest.fn().mockResolvedValue(3),
      expire: jest.fn().mockRejectedValue(new Error('WRONGPASS')),
    });
    await expect(storeWith(redis).increment('k', 60)).resolves.toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('命令挂死时有硬超时兜底，不把登录请求拖死', async () => {
    // 实测：不设 maxRetriesPerRequest 时 ioredis 默认重试 20 次，
    // incr 要 10.7s 才失败。硬超时是这条的兜底。
    jest.useFakeTimers();
    const redis = fakeRedis({ incr: jest.fn().mockReturnValue(new Promise(() => undefined)) });
    const pending = storeWith(redis).increment('k', 60);

    const settled = jest.fn();
    void pending.then(settled);

    // 超时前不该 settle
    await jest.advanceTimersByTimeAsync(REDIS_OP_TIMEOUT_MS - 1);
    expect(settled).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(2);
    await expect(pending).resolves.toBe(0);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('降级返回 0 不会被限流器判成超限', async () => {
    const redis = fakeRedis({ incr: jest.fn().mockRejectedValue(new Error('down')) });
    const limiter = new RateLimiterService(storeWith(redis), { maxAttempts: 1 });
    // 连续 5 次都应放行 —— 0 永远不大于 maxAttempts
    for (let i = 0; i < 5; i += 1) {
      await expect(limiter.check('login:1.2.3.4')).resolves.toBeUndefined();
    }
  });

  describe('优雅关闭', () => {
    it('Redis 正常时走 quit()', async () => {
      const redis = fakeRedis();
      await storeWithClient(redis).onModuleDestroy();
      expect(redis.quit).toHaveBeenCalledTimes(1);
      expect(redis.disconnect).not.toHaveBeenCalled();
    });

    it('从未建过连接时什么都不做', async () => {
      await expect(new RedisRateLimitStore().onModuleDestroy()).resolves.toBeUndefined();
    });

    it('quit() 挂死时超时后强制 disconnect，不卡住优雅关闭', async () => {
      jest.useFakeTimers();
      // Redis 不可达时 quit() 要等服务端应答，永远不解析
      const redis = fakeRedis({ quit: jest.fn().mockReturnValue(new Promise(() => undefined)) });
      const pending = storeWithClient(redis).onModuleDestroy();

      await jest.advanceTimersByTimeAsync(1001);
      await expect(pending).resolves.toBeUndefined();
      // false 参数同时取消 retryStrategy 排好的重连定时器
      expect(redis.disconnect).toHaveBeenCalledWith(false);
    });

    it('quit() 抛错时同样强制 disconnect', async () => {
      const redis = fakeRedis({ quit: jest.fn().mockRejectedValue(new Error('NOAUTH')) });
      await expect(storeWithClient(redis).onModuleDestroy()).resolves.toBeUndefined();
      expect(redis.disconnect).toHaveBeenCalledWith(false);
    });
  });
});
