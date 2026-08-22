import { PoiProxyService } from '../src/venues/poi-proxy.service';
import { mapPoiCategory } from '../src/venues/poi-category.mapper';
import type { MapPoiClient, MapPlace } from '../src/venues/poi-client';
import type { PoiCache } from '../src/venues/poi-cache';

class FakePoiClient implements MapPoiClient {
  result: MapPlace[] | null;
  callCount = 0;
  constructor(result: MapPlace[] | null) {
    this.result = result;
  }
  async searchPlace(): Promise<MapPlace[] | null> {
    this.callCount += 1;
    return this.result;
  }
}

class FakePoiCache implements PoiCache {
  map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    void ttlSeconds;
    this.map.set(key, value);
  }
}

const PLACES: MapPlace[] = [
  { poiId: 'poi-1', name: '有猫咖啡', address: '望京西路 19 号', category: 'cafe', lat: 39.902, lng: 116.403 },
];

const OPTS = { keyword: '咖啡', category: 'cafe', lat: 39.9042, lng: 116.4074 };

function buildProxy(client: MapPoiClient | null, cache: PoiCache): PoiProxyService {
  return new PoiProxyService(client, cache);
}

describe('PoiProxyService', () => {
  it('cache 未命中 → 调 client → 结果写入 cache（key 含 geohash 与 category）→ 返回 places', async () => {
    const client = new FakePoiClient(PLACES);
    const cache = new FakePoiCache();
    const proxy = buildProxy(client, cache);

    const result = await proxy.search(OPTS);

    expect(result).toEqual(PLACES);
    expect(client.callCount).toBe(1);
    const key = [...cache.map.keys()][0];
    expect(key).toContain('poi:gh:');
    expect(key).toContain(':cafe:咖啡');
  });

  it('cache 命中 → 不调 client → 返回缓存 JSON', async () => {
    const client = new FakePoiClient(PLACES);
    const cache = new FakePoiCache();
    // wx4g0b 是演示中心 (39.9042,116.4074) 的真实 geohash（见 geohash.spec）
    await cache.set('poi:gh:wx4g0b:cafe:咖啡', JSON.stringify(PLACES), 600);
    const proxy = buildProxy(client, cache);

    const result = await proxy.search(OPTS);

    expect(result).toEqual(PLACES);
    expect(client.callCount).toBe(0);
  });

  it('client 返回 null（配额耗尽）→ 返回 null，不写缓存', async () => {
    const client = new FakePoiClient(null);
    const cache = new FakePoiCache();
    const proxy = buildProxy(client, cache);

    const result = await proxy.search(OPTS);

    expect(result).toBeNull();
    expect(cache.map.size).toBe(0);
  });

  it('无 key 场景（client 为 null）→ 返回 null，不崩', async () => {
    const cache = new FakePoiCache();
    const proxy = buildProxy(null, cache);

    const result = await proxy.search(OPTS);

    expect(result).toBeNull();
  });

  it('不同 keyword 不同缓存键 → client 被调 2 次', async () => {
    const client = new FakePoiClient(PLACES);
    const cache = new FakePoiCache();
    const proxy = buildProxy(client, cache);

    await proxy.search(OPTS);
    await proxy.search({ ...OPTS, keyword: '医院' });

    expect(client.callCount).toBe(2);
  });
});

describe('mapPoiCategory', () => {
  it.each([
    ['狗狗宠物医院', 'hospital'],
    ['XX宠物美容会所', 'grooming'],
    ['朝阳公园', 'park'],
    ['有猫咖啡', 'cafe'],
    ['神秘小店', 'other'],
  ])('mapPoiCategory(%s) → %s', (raw, expected) => {
    expect(mapPoiCategory(raw)).toBe(expected);
  });
});
