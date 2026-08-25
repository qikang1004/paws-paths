import { InMemoryVenueRepository } from '../src/venues/venue.repository';

describe('InMemoryVenueRepository', () => {
  const repo = new InMemoryVenueRepository();
  const center = { lat: 39.9042, lng: 116.4074 };

  it('无过滤返回全部 10 家，按距离升序', async () => {
    const rows = await repo.search({ ...center });
    expect(rows.length).toBe(10);
    const ds = rows.map((r) => r.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it('category 过滤只回该类目', async () => {
    const rows = await repo.search({ category: 'park', ...center });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.category === 'park')).toBe(true);
  });

  it('keyword 命中名称（子串、大小写不敏感）', async () => {
    const rows = await repo.search({ keyword: '医院', ...center });
    expect(rows.length).toBe(2);
  });

  it('半径过滤裁剪', async () => {
    const rows = await repo.search({ ...center, radiusMeters: 1500 });
    expect(rows.every((r) => (r.distanceMeters as number) <= 1500)).toBe(true);
  });

  it('无坐标：距离 null、按名称排序', async () => {
    const rows = await repo.search({});
    expect(rows.every((r) => r.distanceMeters === null)).toBe(true);
    const names = rows.map((r) => r.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'zh'))).toEqual(names);
  });

  it('getById 命中与 miss', async () => {
    expect((await repo.getById('v-1'))?.name).toBe('宠福康宠物医院');
    expect(await repo.getById('nope')).toBeNull();
  });

  it('listByIds 只回命中的行，不存在的 id 静默丢掉', async () => {
    const rows = await repo.listByIds(['v-3', 'nope', 'v-1']);
    expect(new Set(rows.map((r) => r.poiId))).toEqual(new Set(['v-1', 'v-3']));
    expect(await repo.listByIds([])).toEqual([]);
  });
});
