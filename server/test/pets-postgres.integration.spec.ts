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

  /**
   * 不写死「8 只」：`POST /pets` 上线后 pets 表会长 —— 走查脚本每跑一遍加一只，
   * `pet-write` 那几个套件跑的时候也在建自己的。全表行数一写死，这条断言就变成
   * 「谁都别往这个库里建宠物」（同 48fab02 对种子计数那条的处理）。
   *
   * 总数要和取数用同一套过滤（public + 有封面），否则 `items.length` 对不上：
   * 没有封面的宠物被 `JOIN pet_photos` 挡在页外，而用户新建的宠物在传第一张照片
   * 之前正是这种状态。
   *
   * 距离那半段也不能要求「全部非 null」：用户建宠物时可以不带坐标（偏差 #38），
   * 这些行的 `location` 是 NULL。要证的是它们排在最后（NULLS LAST），
   * 有距离的那截升序。
   */
  it('list：一页装得下时全量返回，种子 8 只都在、有距离的升序在前、没位置的排最后', async () => {
    const { rows } = await pool.query<{ c: number }>(
      `SELECT count(*)::int AS c FROM pets p
       JOIN pet_photos ph ON ph.id = p.cover_photo_id
       WHERE p.visibility = 'public'`,
    );
    const total = rows[0].c;
    const repo = new PostgresPetRepository(pool);
    const { items, hasMore } = await repo.list({
      filter: { species: 'all', breed: 'all' },
      page: 1,
      pageSize: total + 10, // 一页装得下全表，才谈得上「种子 8 只都在结果里」
      ...center,
    });
    expect(items.length).toBe(total);
    expect(hasMore).toBe(false);
    const ids = items.map((i) => i.id);
    for (let n = 1; n <= 8; n += 1) {
      expect(ids).toContain(`p-${n}`);
    }
    const ds = items.map((i) => i.distanceMeters);
    const firstNull = ds.findIndex((d) => d == null);
    const withDistance = (firstNull === -1 ? ds : ds.slice(0, firstNull)) as number[];
    // 种子那 8 只都有坐标，所以有距离的那截至少有 8 项。
    expect(withDistance.length).toBeGreaterThanOrEqual(8);
    expect(ds.slice(withDistance.length).every((d) => d == null)).toBe(true);
    expect([...withDistance].sort((a, b) => a - b)).toEqual(withDistance);
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

  it('findOwnerId：与 seed.sql 一致，不存在回 null', async () => {
    const repo = new PostgresPetRepository(pool);
    expect(await repo.findOwnerId('p-1')).toBe('u-1');
    expect(await repo.findOwnerId('nope')).toBeNull();
  });

  it('listByIds：array_position 保持传入顺序（不是主键序）', async () => {
    const repo = new PostgresPetRepository(pool);
    const rows = await repo.listByIds(['p-5', 'p-1', 'p-3']);
    expect(rows.map((r) => r.id)).toEqual(['p-5', 'p-1', 'p-3']);
  });

  it('listByIds：不存在的 id 静默跳过；空数组不打库', async () => {
    const repo = new PostgresPetRepository(pool);
    expect((await repo.listByIds(['p-1', 'nope'])).map((r) => r.id)).toEqual(['p-1']);
    expect(await repo.listByIds([])).toEqual([]);
  });

  it('listByIds：带坐标算距离，与 getById 的同一坐标结果一致', async () => {
    const repo = new PostgresPetRepository(pool);
    const [row] = await repo.listByIds(['p-7'], center);
    const single = await repo.getById('p-7', center);
    expect(row.distanceMeters).toBeCloseTo(single?.pet.distanceMeters as number, 5);
  });
});
