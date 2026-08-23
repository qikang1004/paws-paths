import { InMemoryFavoritesRepository } from '../src/venues/favorites.repository';
import { InMemoryVenueRepository } from '../src/venues/venue.repository';
import { VenuesService } from '../src/venues/venues.service';
import type { PoiProxyService } from '../src/venues/poi-proxy.service';
import type { MapPlace } from '../src/venues/poi-client';

class FakePoiProxy {
  result: MapPlace[] | null;
  constructor(result: MapPlace[] | null) {
    this.result = result;
  }
  async search(): Promise<MapPlace[] | null> {
    return this.result;
  }
}

/** 上游 POI，poiId 不在 venue_extras 中：走纯 POI 降级标签路径。 */
const POI_PLACES: MapPlace[] = [
  { poiId: 'poi-a', name: '狗狗宠物医院', address: '朝阳区望京西路 48 号', category: '狗狗宠物医院', lat: 39.905, lng: 116.405 },
  { poiId: 'poi-b', name: '有猫咖啡', address: '朝阳区望京西路 19 号', category: '咖啡', lat: 39.902, lng: 116.403 },
];

/** 上游 POI，poiId 命中 venue_extras：运营字段应被 extras 覆盖。 */
const POI_WITH_EXTRAS: MapPlace[] = [
  { poiId: 'v-1', name: '宠福康宠物医院', address: '朝阳区望京西路 48 号', category: '狗狗宠物医院', lat: 39.905, lng: 116.405 },
];

function buildService(proxy: FakePoiProxy | null): VenuesService {
  return new VenuesService(
    proxy as unknown as PoiProxyService | null,
    new InMemoryVenueRepository(),
    new InMemoryFavoritesRepository(),
  );
}

describe('VenuesService', () => {
  it('proxy 返回 null（配额耗尽）→ 回 venue_extras 全量（10 家），rating/avgPrice 有值，tags 来自 extras', async () => {
    const svc = buildService(new FakePoiProxy(null));
    const rows = await svc.search({ category: 'all', lat: 39.9042, lng: 116.4074, userId: null });
    expect(rows.length).toBe(10);
    expect(rows.every((r) => r.rating != null && r.avgPrice != null)).toBe(true);
    expect(rows.find((r) => r.poiId === 'v-1')?.tags).toEqual(['夜间急诊', '猫友好']);
  });

  it('proxy 返回 POI 列表 → 结果来自 POI，rating/avgPrice 为 null、tags === [categoryLabel]', async () => {
    const svc = buildService(new FakePoiProxy(POI_PLACES));
    const rows = await svc.search({ category: 'all', lat: 39.9042, lng: 116.4074, userId: null });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.rating === null && r.avgPrice === null)).toBe(true);
    expect(rows[0].tags).toEqual([rows[0].categoryLabel]);
  });

  it('POI category 经 mapPoiCategory 映射', async () => {
    const svc = buildService(new FakePoiProxy(POI_PLACES));
    const rows = await svc.search({ category: 'all', lat: 39.9042, lng: 116.4074, userId: null });
    const hospital = rows.find((r) => r.poiId === 'poi-a');
    expect(hospital?.category).toBe('hospital');
    expect(hospital?.categoryLabel).toBe('宠物医院');
  });

  it('POI 命中 extras → 用 extras 补 rating/avgPrice/tags/封面', async () => {
    const svc = buildService(new FakePoiProxy(POI_WITH_EXTRAS));
    const rows = await svc.search({ category: 'all', lat: 39.9042, lng: 116.4074, userId: null });
    expect(rows.length).toBe(1);
    expect(rows[0].rating).toBe(4.8);
    expect(rows[0].avgPrice).toBe(320);
    expect(rows[0].tags).toEqual(['夜间急诊', '猫友好']);
    expect(rows[0].coverUrl).toBe('https://picsum.photos/seed/venue-v1/800/500');
  });

  it('无坐标 → 直接 extras，distanceMeters null', async () => {
    const svc = buildService(new FakePoiProxy(POI_PLACES));
    const rows = await svc.search({ category: 'all', userId: null });
    expect(rows.length).toBe(10);
    expect(rows.every((r) => r.distanceMeters === null)).toBe(true);
  });

  it('userId 传入且收藏过 v-2 → v-2 isFavorite true，其余 false', async () => {
    const svc = buildService(new FakePoiProxy(null));
    await svc.setFavorite('v-2', 'u-1', true);
    const rows = await svc.search({ category: 'all', lat: 39.9042, lng: 116.4074, userId: 'u-1' });
    expect(rows.find((r) => r.poiId === 'v-2')?.isFavorite).toBe(true);
    expect(rows.filter((r) => r.isFavorite).length).toBe(1);
  });

  it("detail('v-1') 返回 extras 补全的 Venue；detail('nope') → null", async () => {
    const svc = buildService(new FakePoiProxy(POI_PLACES));
    const d = await svc.detail('v-1', null);
    expect(d?.name).toBe('宠福康宠物医院');
    expect(d?.rating).toBe(4.8);
    expect(d?.lat).toBe(39.905);
    expect(await svc.detail('nope', null)).toBeNull();
  });

  it('setFavorite 幂等：add → detail isFavorite true；再 remove → false；重复 add 不崩', async () => {
    const svc = buildService(new FakePoiProxy(null));
    await svc.setFavorite('v-1', 'u-1', true);
    expect((await svc.detail('v-1', 'u-1'))?.isFavorite).toBe(true);
    await svc.setFavorite('v-1', 'u-1', true); // 幂等
    expect((await svc.detail('v-1', 'u-1'))?.isFavorite).toBe(true);
    await svc.setFavorite('v-1', 'u-1', false);
    expect((await svc.detail('v-1', 'u-1'))?.isFavorite).toBe(false);
  });
});
