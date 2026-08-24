import { Pool } from 'pg';
import {
  haversineMeters,
  InMemoryPetRepository,
  PostgresPetRepository,
} from '../src/pets/pet.repository';

/** PostGIS 宠物查询集成测试：DATABASE_URL 门控，无库优雅跳过。 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('pets postgres integration', () => {
  let pool: Pool;
  const center = { lat: 39.9042, lng: 116.4074 };

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('list：无过滤返回 8 只、按距离升序、距离非 null', async () => {
    const repo = new PostgresPetRepository(pool);
    const { items, hasMore } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: 20,
      ...center,
    });
    expect(items.length).toBe(8);
    expect(hasMore).toBe(false);
    expect(items.every((i) => i.distanceMeters != null)).toBe(true);
    const ds = items.map((i) => i.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it('list：物种过滤只回猫', async () => {
    const repo = new PostgresPetRepository(pool);
    const { items } = await repo.list({
      filter: { species: 'cat', breed: 'all' },
      page: 1,
      pageSize: 20,
      ...center,
    });
    expect(items.every((i) => i.species === 'cat')).toBe(true);
  });

  it('getById：p-1 为大黄且 photos >= 2', async () => {
    const repo = new PostgresPetRepository(pool);
    const found = await repo.getById('p-1', center);
    expect(found?.pet.name).toBe('大黄');
    expect((found?.photos.length ?? 0)).toBeGreaterThanOrEqual(2);
  });

  it('距离与 InMemory haversine 一致（±50m）', async () => {
    const pg = new PostgresPetRepository(pool);
    const mem = new InMemoryPetRepository();
    const [pgRow, memRow] = await Promise.all([
      pg.getById('p-7', center),
      mem.getById('p-7', center),
    ]);
    const pgDist = pgRow?.pet.distanceMeters;
    const memDist = memRow?.pet.distanceMeters;
    expect(typeof pgDist).toBe('number');
    expect(typeof memDist).toBe('number');
    expect(Math.abs((pgDist as number) - (memDist as number))).toBeLessThanOrEqual(50);
    // 交叉验证：InMemory 的 haversine 独立实现
    expect(memDist).toBeCloseTo(haversineMeters(center.lat, center.lng, 39.915, 116.418), 0);
  });
});
