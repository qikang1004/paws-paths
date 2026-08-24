import { Pool } from 'pg';
import { runMigrations } from '../src/database/migrations';

/**
 * PostGIS 集成测试：以 DATABASE_URL 存在为门控（与 REDIS_INTEGRATION 同款）。
 * 无数据库环境优雅跳过；设了 DATABASE_URL 且数据库就绪时全量跑真库断言。
 * 本机起库：docker compose up -d（postgis + redis，见仓库根 docker-compose.yml）。
 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('postgres integration', () => {
  let pool: Pool;

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('建出 5 张业务表', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of ['users', 'pets', 'pet_photos', 'venue_extras', 'favorites']) {
      expect(names).toContain(t);
    }
  });

  it('postgis 扩展可用且 pets.location 有 GiST 索引', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'postgis'`,
    );
    expect(rows.length).toBe(1);
    // pg_indexes.indexdef 里的方法名是小写 gist，用 ILIKE 而不是大小写敏感的 LIKE。
    const idx = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'pets' AND indexdef ILIKE '%USING gist%'`,
    );
    expect(idx.rows.length).toBe(1);
  });

  // 只数种子行（id 形如 u-1 / p-1 / v-1），不数全表：别的套件会插自己的测试用户，
  // 写死全表行数会让这条断言随邻居的数据起伏。
  it('seed 后 8 只宠物、10 家场所、8 位主人', async () => {
    const seeded = [
      ['pets', 'p-', 8],
      ['venue_extras', 'v-', 10],
      ['users', 'u-', 8],
    ] as const;
    for (const [table, prefix, n] of seeded) {
      const col = table === 'venue_extras' ? 'poi_id' : 'id';
      const { rows } = await pool.query(
        `SELECT count(*)::int AS c FROM ${table} WHERE ${col} ~ ('^' || $1 || '[0-9]+$')`,
        [prefix],
      );
      expect(rows[0].c).toBe(n);
    }
  });

  it('迁移幂等：重复执行不报错、计数不变', async () => {
    await runMigrations(pool, { seed: true });
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM pets`);
    expect(rows[0].c).toBe(8);
  });
});
