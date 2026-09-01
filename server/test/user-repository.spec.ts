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
    // favorites 在阶段 2 迁成多态：(user_id, target_type, target_id)，不再有 poi_id。
    await pool.query(
      `INSERT INTO favorites (user_id, target_type, target_id) VALUES ($1, 'venue', $2)
       ON CONFLICT DO NOTHING`,
      [user!.id, 'v-3'],
    );
    const { rows } = await pool.query(`SELECT count(*)::int c FROM favorites WHERE user_id = $1`, [
      user!.id,
    ]);
    expect(rows[0].c).toBe(1);
    await pool.query(`DELETE FROM favorites WHERE user_id = $1`, [user!.id]);
  });
});

/**
 * `findCredentialByUsername` 的白名单筛。
 *
 * 真库上造不出「role 是乱值」的行 —— 列上有 CHECK，而绕过它要 DROP CONSTRAINT，
 * 那是 ACCESS EXCLUSIVE 锁的 DDL，会与 Jest 并行跑的邻居套件等成环
 * （`test/global-setup.ts` 的注释里记着这个坑）。所以这一条用替身验：
 * 要证的是「仓储不信库里的值」，而不是「库拦不拦」。
 */
describe('PostgresUserRepository.findCredentialByUsername 的角色白名单', () => {
  const rowWith = (role: string) => ({
    query: async () => ({ rows: [{ id: 'u-x', password_hash: 'scrypt$1$1$1$c2E$aGE', role }] }),
  });

  it('合法角色照常返回', async () => {
    const repo = new PostgresUserRepository(rowWith('admin') as unknown as Pool);
    expect(await repo.findCredentialByUsername('ops')).toMatchObject({
      userId: 'u-x',
      role: 'admin',
    });
  });

  /** 库里被手改成乱值时返回 null —— 未知字符串不该在守卫里被当成有效角色。 */
  it('白名单外的角色返回 null', async () => {
    const repo = new PostgresUserRepository(rowWith('超级管理员') as unknown as Pool);
    expect(await repo.findCredentialByUsername('ops')).toBeNull();
  });

  /**
   * `user` 也在白名单里，所以它会被返回 —— 但那种账号在 `ModeratorGuard` 那边
   * 仍然是 403。这条断言钉住这个分工：**仓储不做权限判断**，它只报事实。
   */
  it('role=user 也返回（权限由守卫判，不在仓储里判）', async () => {
    const repo = new PostgresUserRepository(rowWith('user') as unknown as Pool);
    expect(await repo.findCredentialByUsername('ops')).toMatchObject({ role: 'user' });
  });
});
