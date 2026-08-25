import { InMemoryPetRepository, type PetQuery } from '../src/pets/pet.repository';

describe('InMemoryPetRepository', () => {
  const repo = new InMemoryPetRepository();
  const center = { lat: 39.9042, lng: 116.4074 };

  it('无过滤：按距离升序返回全部，带距离', async () => {
    const { items, hasMore } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 20,
      ...center,
    });
    expect(items.length).toBe(8);
    expect(items[0].distanceMeters).not.toBeNull();
    const ds = items.map((i) => i.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
    expect(hasMore).toBe(false);
  });

  it('物种过滤只回该物种', async () => {
    const { items } = await repo.list({
      filter: { species: 'cat', breed: 'all' },
      page: 1,
      pageSize: 20,
      ...center,
    });
    expect(items.every((i) => i.species === 'cat')).toBe(true);
  });

  it('品种过滤命中 breed', async () => {
    const { items } = await repo.list({
      filter: { species: 'dog', breed: '金毛' },
      page: 1,
      pageSize: 20,
      ...center,
    });
    expect(items.length).toBe(1);
    expect(items[0].name).toBe('大黄');
  });

  it('半径过滤裁剪范围', async () => {
    const { items } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 20,
      ...center,
      radiusMeters: 800,
    });
    const ds = items.map((i) => i.distanceMeters as number);
    expect(ds.every((d) => d <= 800)).toBe(true);
    expect(items.length).toBeLessThan(8);
  });

  it('分页：page=2 与第一页不重叠且 hasMore 正确', async () => {
    const a = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 3,
      ...center,
    });
    expect(a.hasMore).toBe(true);
    const b = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 2,
      pageSize: 3,
      ...center,
    });
    expect(b.items.length).toBe(3);
    expect(b.hasMore).toBe(true);
    expect(a.items.map((i) => i.id)).not.toEqual(
      expect.arrayContaining(b.items.map((i) => i.id)),
    );
  });

  it('无坐标（城市模式）：距离为 null，按 lastActiveAt 倒序', async () => {
    const { items } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 20,
    });
    expect(items.every((i) => i.distanceMeters === null)).toBe(true);
    expect(items[0].name).toBe('旺财');
  });

  it('getById 返回宠物与全部照片', async () => {
    const found = await repo.getById('p-1');
    expect(found?.pet.name).toBe('大黄');
    expect((found?.photos.length ?? 0)).toBeGreaterThanOrEqual(2);
    expect(await repo.getById('nope')).toBeNull();
  });

  it('findOwnerId 与 seed.sql 的归属一致；不存在回 null', async () => {
    expect(await repo.findOwnerId('p-1')).toBe('u-1');
    expect(await repo.findOwnerId('p-5')).toBe('u-5');
    expect(await repo.findOwnerId('nope')).toBeNull();
  });

  it('归属不下发客户端：PetRow 上没有 ownerId', async () => {
    const found = await repo.getById('p-1');
    expect(found?.pet).not.toHaveProperty('ownerId');
  });

  it('listByIds 保持传入顺序，不是 id 的字典序', async () => {
    const rows = await repo.listByIds(['p-3', 'p-1', 'p-2']);
    expect(rows.map((r) => r.id)).toEqual(['p-3', 'p-1', 'p-2']);
  });

  it('listByIds 静默跳过不存在的 id —— 关注的宠物被删了，列表少一条而不是 500', async () => {
    const rows = await repo.listByIds(['p-1', 'nope', 'p-2']);
    expect(rows.map((r) => r.id)).toEqual(['p-1', 'p-2']);
  });

  it('listByIds 空数组回空，不打库', async () => {
    expect(await repo.listByIds([])).toEqual([]);
  });

  it('listByIds 带坐标算距离，不带则 null', async () => {
    const withCoords = await repo.listByIds(['p-1'], center);
    expect(withCoords[0].distanceMeters).not.toBeNull();
    const without = await repo.listByIds(['p-1']);
    expect(without[0].distanceMeters).toBeNull();
  });
});
