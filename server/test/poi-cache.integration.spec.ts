import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { RedisPoiCache } from '../src/venues/poi-cache';
import { PoiProxyService } from '../src/venues/poi-proxy.service';
import type { MapPlace, MapPoiClient } from '../src/venues/poi-client';

/**
 * POI 缓存的真实 Redis 验证。
 *
 * 无 TENCENT_MAP_KEY 时腾讯上游那次 HTTP 调用没法验（正式 key 需要账号），
 * 但缓存层是可以真验的：单元测试用的是内存 Map，TTL 有没有真落到键上、中文
 * 键的编码、JSON 往返、坏缓存回源，这些在真 Redis 上从没跑过。
 *
 * 跑法（先起 Redis）：
 *   REDIS_INTEGRATION=1 npx jest test/poi-cache.integration.spec.ts
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';

const REDIS_INTEGRATION_ENABLED = /^(1|true|yes)$/i.test(
  process.env.REDIS_INTEGRATION ?? '',
);

if (!REDIS_INTEGRATION_ENABLED) {
  console.warn(
    '[skip] POI 缓存集成测试：设 REDIS_INTEGRATION=1 且起真 Redis 后才会运行。',
  );
}

const describeRedis = REDIS_INTEGRATION_ENABLED ? describe : describe.skip;

/** 记录调用次数，用来判断缓存到底命中没有。 */
class CountingPoiClient implements MapPoiClient {
  callCount = 0;
  constructor(private readonly result: MapPlace[] | null) {}
  async searchPlace(): Promise<MapPlace[] | null> {
    this.callCount += 1;
    return this.result;
  }
}

const PLACES: MapPlace[] = [
  {
    poiId: 'poi-int-1',
    name: '有猫咖啡',
    address: '望京西路 19 号',
    category: 'cafe',
    lat: 39.902,
    lng: 116.403,
  },
];

describeRedis('POI 缓存 真实 Redis 集成测试', () => {
  let cache: RedisPoiCache;
  let cleanup: Redis;
  const prefix = `test:poi:${randomUUID()}:`;

  beforeAll(() => {
    cache = new RedisPoiCache();
    cleanup = new Redis(REDIS_URL, { lazyConnect: true });
  });

  afterAll(async () => {
    for (const pattern of [`${prefix}*`, 'poi:gh:*']) {
      const keys = await cleanup.keys(pattern);
      if (keys.length > 0) await cleanup.del(...keys);
    }
    // disconnect 而非 quit：懒连接客户端可能从未连上，那时 quit() 不会解析
    cleanup.disconnect();
    await cache.onModuleDestroy();
  });

  describe('RedisPoiCache', () => {
    it('写入可读，TTL 真的落到键上', async () => {
      const key = `${prefix}ttl`;
      await cache.set(key, 'payload', 600);
      expect(await cache.get(key)).toBe('payload');

      const ttl = await cleanup.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(600);
    });

    it('不存在的键返回 null', async () => {
      expect(await cache.get(`${prefix}missing`)).toBeNull();
    });

    it('中文键与中文值往返无损（缓存键含 keyword）', async () => {
      const key = `${prefix}gh:wx4g0b:cafe:咖啡`;
      const value = JSON.stringify(PLACES);
      await cache.set(key, value, 600);
      expect(await cache.get(key)).toBe(value);
      // 从 Redis 侧读也应一致，排除编码问题
      expect(await cleanup.get(key)).toBe(value);
    });

    it('TTL 到期后自动消失（过期由 Redis 侧执行）', async () => {
      const key = `${prefix}expiring`;
      await cache.set(key, 'short-lived', 1);
      expect(await cache.get(key)).toBe('short-lived');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(await cache.get(key)).toBeNull();
    });
  });

  describe('PoiProxyService 接真 Redis', () => {
    it('首次未命中调上游并回填，二次命中不再调上游', async () => {
      const client = new CountingPoiClient(PLACES);
      const proxy = new PoiProxyService(client, cache);
      // geohash 由坐标算出，键形如 poi:gh:wx4g0b:cafe:咖啡
      const opts = { keyword: '咖啡', category: 'cafe', lat: 39.9042, lng: 116.4074 };

      expect(await proxy.search(opts)).toEqual(PLACES);
      expect(client.callCount).toBe(1);

      // 真 Redis 里应能看到那个键
      const keys = await cleanup.keys('poi:gh:*:cafe:咖啡');
      expect(keys.length).toBe(1);
      expect(keys[0]).toContain('wx4g0b');

      expect(await proxy.search(opts)).toEqual(PLACES);
      expect(client.callCount).toBe(1); // 命中缓存，没再调上游
    });

    it('坏缓存（非 JSON）当作未命中，回源而不是抛错', async () => {
      const client = new CountingPoiClient(PLACES);
      const proxy = new PoiProxyService(client, cache);
      const opts = { keyword: '兽医', category: 'hospital', lat: 39.9042, lng: 116.4074 };

      await cleanup.set('poi:gh:wx4g0b:hospital:兽医', '{ 这不是合法 JSON', 'EX', 600);

      expect(await proxy.search(opts)).toEqual(PLACES);
      expect(client.callCount).toBe(1);
    });

    it('上游返回空数组时不写缓存，下次仍回源', async () => {
      const client = new CountingPoiClient([]);
      const proxy = new PoiProxyService(client, cache);
      const opts = { keyword: '空结果', category: 'other', lat: 39.9042, lng: 116.4074 };

      expect(await proxy.search(opts)).toEqual([]);
      expect(await cleanup.keys('poi:gh:*:other:空结果')).toHaveLength(0);

      await proxy.search(opts);
      expect(client.callCount).toBe(2);
    });

    it('上游失败（null）不写缓存，交给上层降级 venue_extras', async () => {
      const client = new CountingPoiClient(null);
      const proxy = new PoiProxyService(client, cache);
      const opts = { keyword: '配额耗尽', category: 'cafe', lat: 39.9042, lng: 116.4074 };

      expect(await proxy.search(opts)).toBeNull();
      expect(await cleanup.keys('poi:gh:*:cafe:配额耗尽')).toHaveLength(0);
    });
  });
});
