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

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    await runMigrations(pool);
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
    const idx = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'pets' AND indexdef LIKE '%GIST%'`,
    );
    expect(idx.rows.length).toBe(1);
  });

  it('seed 后 8 只宠物、10 家场所、8 位主人', async () => {
    for (const [t, n] of [['pets', 8], ['venue_extras', 10], ['users', 8]] as const) {
      const { rows } = await pool.query(`SELECT count(*)::int AS c FROM ${t}`);
      expect(rows[0].c).toBe(n);
    }
  });

  it('迁移幂等：重复执行不报错、计数不变', async () => {
    await runMigrations(pool);
    const { rows } = await pool.query(`SELECT count(*)::int AS c FROM pets`);
    expect(rows[0].c).toBe(8);
  });
});
