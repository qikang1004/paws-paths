import { Pool } from 'pg';
import { PostgresFavoritesRepository } from '../src/venues/favorites.repository';

/** 收藏表集成测试：DATABASE_URL 门控，无库优雅跳过。 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('favorites postgres integration', () => {
  let pool: Pool;
  const userId = 'u-1';
  const poiId = 'v-4';

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次；用例用的种子用户 u-1 已存在。
    pool = new Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM favorites WHERE user_id = $1`, [userId]);
    await pool.end();
  });

  it('add 幂等两次 → list 回 1 条；remove 后为空', async () => {
    const repo = new PostgresFavoritesRepository(pool);
    await repo.remove(userId, poiId);

    await repo.add(userId, poiId);
    await repo.add(userId, poiId);
    expect(await repo.list(userId)).toEqual([poiId]);

    await repo.remove(userId, poiId);
    expect(await repo.list(userId)).toEqual([]);
  });

  it('remove 不存在的收藏不报错（幂等）', async () => {
    const repo = new PostgresFavoritesRepository(pool);
    await expect(repo.remove(userId, 'nope')).resolves.toBeUndefined();
  });
});
