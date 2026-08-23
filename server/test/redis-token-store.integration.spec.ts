import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RedisTokenStore } from '../src/wechat/token-store';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

// 显式门控：只有 REDIS_INTEGRATION=1 且本机有真 Redis 才运行，避免无 Redis 环境
// 的 CI/本地把套件打成红或白等连接超时。跑法（先起 Redis）：
//   docker run -d -p 6379:6379 redis:7-alpine
//   REDIS_INTEGRATION=1 npx jest test/redis-token-store.integration.spec.ts
const REDIS_INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(
  process.env.REDIS_INTEGRATION ?? '',
);

if (!REDIS_INTEGRATION_ENABLED) {
  console.warn('[skip] RedisTokenStore 集成测试：设 REDIS_INTEGRATION=1 且起真 Redis 后才会运行。');
}

const describeRedis = REDIS_INTEGRATION_ENABLED ? describe : describe.skip;

// FakeTokenStore 只在镜像语义；这里跑真 Redis，锁的 compare-and-delete 用的是
// releaseLock 里那段真实 Lua：owner 匹配才删、不匹配保留。单元测试测不到这层。
describeRedis('RedisTokenStore 真实 Redis 集成测试', () => {
  let store: RedisTokenStore;
  let cleanup: Redis;
  const prefix = `test:token-store:${randomUUID()}:`;

  beforeAll(() => {
    store = new RedisTokenStore();
    cleanup = new Redis(REDIS_URL, { lazyConnect: true });
  });

  afterAll(async () => {
    const keys = await cleanup.keys(`${prefix}*`);
    if (keys.length > 0) await cleanup.del(...keys);
    await cleanup.disconnect();
    await store.onModuleDestroy();
  });

  const key = (name: string) => `${prefix}${name}`;

  it('acquireLock：持有期间第二次获取返回 null（SET NX EX 原子占锁）', async () => {
    const a = await store.acquireLock(key('lock'), 10);
    expect(a).not.toBeNull();
    const b = await store.acquireLock(key('lock'), 10);
    expect(b).toBeNull();
    await store.releaseLock(key('lock'), a!);
  });

  it('releaseLock：wrong owner 触发 Lua 比较删除，锁不释放', async () => {
    const a = await store.acquireLock(key('lock'), 10);
    await store.releaseLock(key('lock'), 'wrong-owner');
    const again = await store.acquireLock(key('lock'), 10);
    expect(again).toBeNull();
    await store.releaseLock(key('lock'), a!);
  });

  it('releaseLock：正确 owner 释放后，锁可再次获取', async () => {
    const a = await store.acquireLock(key('lock'), 10);
    await store.releaseLock(key('lock'), a!);
    const b = await store.acquireLock(key('lock'), 10);
    expect(b).not.toBeNull();
    await store.releaseLock(key('lock'), b!);
  });

  it('锁 TTL 到期后自动可获取（过期由 Redis 侧执行）', async () => {
    const a = await store.acquireLock(key('lock'), 1);
    expect(a).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const b = await store.acquireLock(key('lock'), 1);
    expect(b).not.toBeNull();
    await store.releaseLock(key('lock'), b!);
  });

  it('setWithTtl / get：写入可读，TTL 到期后返回 null', async () => {
    await store.setWithTtl(key('val'), 'hello', 1);
    expect(await store.get(key('val'))).toBe('hello');
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await store.get(key('val'))).toBeNull();
  });

  it('get：不存在的键返回 null', async () => {
    expect(await store.get(key('missing'))).toBeNull();
  });
});
