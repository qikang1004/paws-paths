import { Pool } from 'pg';
import {
  InMemoryUserRepository,
  PostgresUserRepository,
  type UserRepository,
} from '../src/users/user.repository';

/**
 * 两种实现必须行为一致：之前 UsersModule 只接了 InMemory，
 * 设了 DATABASE_URL 也一样只存内存，导致 favorites 插入时外键失败
 * （favorites.user_id 指向 users，而用户从没真正落库）。
 */
const DB_URL = process.env.DATABASE_URL;

describe('InMemoryUserRepository', () => {
  const repo: UserRepository = new InMemoryUserRepository();
  const openid = 'test-openid-mem';

  it('首次 findByOpenid 返回 null', async () => {
    expect(await repo.findByOpenid(openid)).toBeNull();
  });

  it('create 后能按 openid 找回，且 id 稳定', async () => {
    const created = await repo.create(openid);
    expect(created.openid).toBe(openid);
    expect(created.id).toBeTruthy();
    expect((await repo.findByOpenid(openid))?.id).toBe(created.id);
  });
});

const describeDb = DB_URL ? describe : describe.skip;
describeDb('PostgresUserRepository', () => {
  let pool: Pool;
  let repo: PostgresUserRepository;
  const openid = `test-openid-pg-${Date.now()}`;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    repo = new PostgresUserRepository(pool);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE openid = $1`, [openid]);
    await pool.end();
  });

  it('用户真的落库，且能按 openid 找回', async () => {
    expect(await repo.findByOpenid(openid)).toBeNull();
    const created = await repo.create(openid);
    const found = await repo.findByOpenid(openid);
    expect(found?.id).toBe(created.id);

    // 直查库确认不是只在内存里
    const { rows } = await pool.query(`SELECT id FROM users WHERE openid = $1`, [openid]);
    expect(rows[0].id).toBe(created.id);
  });

  it('落库的用户能被 favorites 的外键接受', async () => {
    const user = await repo.findByOpenid(openid);
    await pool.query(
      `INSERT INTO favorites (user_id, poi_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [user!.id, 'v-3'],
    );
    const { rows } = await pool.query(`SELECT count(*)::int c FROM favorites WHERE user_id = $1`, [
      user!.id,
    ]);
    expect(rows[0].c).toBe(1);
    await pool.query(`DELETE FROM favorites WHERE user_id = $1`, [user!.id]);
  });
});
