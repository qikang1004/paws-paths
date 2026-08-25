import { Pool } from 'pg';
import {
  haversineMeters,
  InMemoryVenueRepository,
  PostgresVenueRepository,
} from '../src/venues/venue.repository';

/** PostGIS 场所查询集成测试：DATABASE_URL 门控，无库优雅跳过。 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('venues postgres integration', () => {
  let pool: Pool;
  const center = { lat: 39.9042, lng: 116.4074 };

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('search：无过滤返回 10 家、按距离升序、距离非 null', async () => {
    const repo = new PostgresVenueRepository(pool);
    const rows = await repo.search({ ...center });
    expect(rows.length).toBe(10);
    expect(rows.every((r) => r.distanceMeters != null)).toBe(true);
    const ds = rows.map((r) => r.distanceMeters as number);
    expect([...ds].sort((a, b) => a - b)).toEqual(ds);
  });

  it('search：category=hospital 只回医院', async () => {
    const repo = new PostgresVenueRepository(pool);
    const rows = await repo.search({ category: 'hospital', ...center });
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.category === 'hospital')).toBe(true);
  });

  it('getById：v-1 为宠福康宠物医院', async () => {
    const repo = new PostgresVenueRepository(pool);
    const found = await repo.getById('v-1');
    expect(found?.name).toBe('宠福康宠物医院');
  });

  it('listByIds：批量取行，与 InMemory 同集合', async () => {
    const ids = ['v-9', 'v-1', 'v-不存在'];
    const pg = await new PostgresVenueRepository(pool).listByIds(ids);
    const mem = await new InMemoryVenueRepository().listByIds(ids);
    // 不保证顺序（接口如此声明），比集合
    expect(new Set(pg.map((r) => r.poiId))).toEqual(new Set(['v-1', 'v-9']));
    expect(new Set(pg.map((r) => r.name))).toEqual(new Set(mem.map((r) => r.name)));
  });

  it('listByIds：空数组不打库，直接回空', async () => {
    expect(await new PostgresVenueRepository(pool).listByIds([])).toEqual([]);
  });

  it('距离与 InMemory haversine 一致（±50m）', async () => {
    // getById 无坐标时 distance 为 null（附录 D），距离一致性经 search 对比
    const pg = new PostgresVenueRepository(pool);
    const mem = new InMemoryVenueRepository();
    const [pgRows, memRows] = await Promise.all([
      pg.search({ ...center }),
      mem.search({ ...center }),
    ]);
    const pgDist = pgRows.find((r) => r.poiId === 'v-8')?.distanceMeters;
    const memDist = memRows.find((r) => r.poiId === 'v-8')?.distanceMeters;
    expect(typeof pgDist).toBe('number');
    expect(typeof memDist).toBe('number');
    expect(Math.abs((pgDist as number) - (memDist as number))).toBeLessThanOrEqual(50);
    // 交叉验证：InMemory 的 haversine 独立实现
    expect(memDist).toBeCloseTo(haversineMeters(center.lat, center.lng, 39.915, 116.412), 0);
  });
});
