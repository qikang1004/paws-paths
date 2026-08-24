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

  it('建出 9 张业务表', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of [
      'users',
      'pets',
      'pet_photos',
      'venue_extras',
      'favorites',
      'follows',
      'view_history',
      'posts',
      'post_images',
    ]) {
      expect(names).toContain(t);
    }
  });

  describe('阶段 2 新表的约束（真库层面）', () => {
    it('follows 的 (follower_id, target_pet_id) 唯一约束真实生效', async () => {
      // 幂等关注依赖它兜底：ON CONFLICT DO NOTHING 需要这个约束才有落点
      const dup = pool.query(
        `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1,'u-1','p-2')`,
        ['f-dup-probe'],
      );
      await expect(dup).rejects.toThrow(/duplicate key|unique/i);
    });

    it('view_history 的 (user_id, target_type, target_id) 唯一约束支撑幂等更新', async () => {
      const before = await pool.query(
        `SELECT viewed_at FROM view_history WHERE user_id='u-1' AND target_type='pet' AND target_id='p-3'`,
      );
      expect(before.rows.length).toBe(1);

      // 幂等写入：冲突时只更新时间戳，不新增行
      await pool.query(
        `INSERT INTO view_history (id, user_id, target_type, target_id) VALUES ($1,'u-1','pet','p-3')
         ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET viewed_at = now()`,
        ['vh-probe'],
      );

      const after = await pool.query(
        `SELECT count(*)::int AS c, max(viewed_at) AS t FROM view_history
         WHERE user_id='u-1' AND target_type='pet' AND target_id='p-3'`,
      );
      expect(after.rows[0].c).toBe(1);
      expect(new Date(after.rows[0].t).getTime()).toBeGreaterThan(
        new Date(before.rows[0].viewed_at).getTime(),
      );
    });

    it('audit_status 的 CHECK 拦下非法状态值', async () => {
      const bad = pool.query(
        `INSERT INTO posts (id, pet_id, author_id, content, audit_status)
         VALUES ($1,'p-1','u-1','x','不存在的状态')`,
        ['po-bad-probe'],
      );
      await expect(bad).rejects.toThrow(/check constraint|violates/i);
    });

    it('post_images 的宽高必须为正（瀑布流预估高度依赖它）', async () => {
      const bad = pool.query(
        `INSERT INTO post_images (id, post_id, url, width, height)
         VALUES ($1,'po-1','http://x/y.jpg',0,100)`,
        ['pi-bad-probe'],
      );
      await expect(bad).rejects.toThrow(/check constraint|violates/i);
    });

    it('posts 的可见性查询路径有复合索引', async () => {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = 'posts' AND indexname = 'posts_pet_visible_idx'`,
      );
      expect(rows.length).toBe(1);
    });

    it('follows / posts 的外键要求用户与宠物真实存在', async () => {
      await expect(
        pool.query(`INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1,'u-1','p-不存在')`, [
          'f-fk-probe',
        ]),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        pool.query(
          `INSERT INTO posts (id, pet_id, author_id, content) VALUES ($1,'p-1','u-不存在','x')`,
          ['po-fk-probe'],
        ),
      ).rejects.toThrow(/foreign key/i);
    });
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
  it('seed 后 8 只宠物、10 家场所、8 位主人，以及阶段 2 的关系数据', async () => {
    const seeded = [
      ['pets', 'p-', 8],
      ['venue_extras', 'v-', 10],
      ['users', 'u-', 8],
      // 阶段 2
      ['follows', 'f-', 3],
      ['view_history', 'vh-', 4],
      ['posts', 'po-', 5],
      ['post_images', 'pi-', 6],
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
