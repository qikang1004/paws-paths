import { Pool } from 'pg';
import { upsertAdminAccount, adminOpenid } from '../src/auth/admin-account';
import { hashPassword, verifyPassword } from '../src/auth/password';
import { PostgresUserRepository } from '../src/users/user.repository';

/**
 * 运营账号在**真库**上的行为：建号 → 按用户名取凭据 → 验密码。
 *
 * 这一套补的是本阶段最大的验证缺口：`upsertAdminAccount` 那条 CTE、
 * `findCredentialByUsername` 那条 SQL、以及新加的两列与部分唯一索引，
 * 此前全都只经过编译和内存实现 —— **CLI 一次都没连过真库**，也就没人证明过
 * 「建出来的账号真能登进去」。单元测试证不了这件事：它们看得到的只有 SQL 文本。
 *
 * 门控与其他集成套件同款（`DATABASE_URL` 存在才跑）。建表由
 * `test/global-setup.ts` 全局跑一次。
 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('运营账号（真库）', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  /**
   * 在事务里跑再回滚：这个库是共享的远程实例，而本套件**会写 users 表**。
   * 留下的行会让别的套件（种子计数、走查）数不清 —— 那种假红调查过两次
   * （commit 48fab02 与 9475fdf）。
   *
   * 仓储与 upsert 都只要一个能 `query` 的东西，所以它们能共用同一个事务里的
   * client；`PostgresUserRepository` 的构造参数标的是 `Pool`，而 `PoolClient`
   * 的 `query` 面兼容，用一次 as 收窄。
   */
  const inRollback = async (
    fn: (ctx: { db: import('pg').PoolClient; repo: PostgresUserRepository }) => Promise<void>,
  ): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn({ db: client, repo: new PostgresUserRepository(client as unknown as Pool) });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  /** 每个用例一个独立用户名：并行跑的邻居套件也在同一张表上。 */
  const uniq = (): string => `ops-it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  it('建号返回 created=true，并在库里落下一行', async () => {
    await inRollback(async ({ db }) => {
      const username = uniq();
      const result = await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword('a-long-enough-password'),
        role: 'moderator',
      });
      expect(result).toMatchObject({ created: true });
      const { rows } = await db.query<{ username: string; role: string; openid: string }>(
        `SELECT username, role, openid FROM users WHERE id = $1`,
        [result?.userId],
      );
      expect(rows[0]).toEqual({ username, role: 'moderator', openid: adminOpenid(username) });
    });
  });

  /**
   * 整条链的核心断言：**CLI 建出来的账号，登录那条查询真的取得到，密码真的验得过。**
   * 这一条此前没有任何测试覆盖 —— 它跨了 upsert、部分唯一索引、
   * `findCredentialByUsername` 与 scrypt 校验四处。
   */
  it('建出来的账号能被登录查询取到，且密码验得过', async () => {
    await inRollback(async ({ db, repo }) => {
      const username = uniq();
      const password = 'correct-horse-battery';
      await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword(password),
        role: 'admin',
      });

      const credential = await repo.findCredentialByUsername(username);
      expect(credential).not.toBeNull();
      expect(credential?.role).toBe('admin');
      expect(await verifyPassword(password, credential!.passwordHash)).toBe(true);
      expect(await verifyPassword('wrong-password-here', credential!.passwordHash)).toBe(false);
    });
  });

  it('同一个用户名再跑一次是改密码与改角色，不是插第二行', async () => {
    await inRollback(async ({ db, repo }) => {
      const username = uniq();
      const first = await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword('the-first-password'),
        role: 'moderator',
      });
      const second = await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword('the-second-password'),
        role: 'admin',
      });

      // 同一行：id 不变，created 翻成 false。
      expect(second).toEqual({ userId: first?.userId, created: false });
      const { rows } = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users WHERE username = $1`,
        [username],
      );
      expect(rows[0].n).toBe('1');

      // 新密码验得过，旧密码验不过 —— 这就是「兼作重置密码工具」的证据。
      const credential = await repo.findCredentialByUsername(username);
      expect(credential?.role).toBe('admin');
      expect(await verifyPassword('the-second-password', credential!.passwordHash)).toBe(true);
      expect(await verifyPassword('the-first-password', credential!.passwordHash)).toBe(false);
    });
  });

  /** 降权也走同一条路（`admin → moderator`），CLI 没有单独的改角色命令。 */
  it('角色可以降回来', async () => {
    await inRollback(async ({ db, repo }) => {
      const username = uniq();
      const hash = await hashPassword('a-long-enough-password');
      await upsertAdminAccount(db, { username, passwordHash: hash, role: 'admin' });
      await upsertAdminAccount(db, { username, passwordHash: hash, role: 'moderator' });
      expect((await repo.findCredentialByUsername(username))?.role).toBe('moderator');
    });
  });

  /**
   * 小程序用户（`username` 为 NULL）在登录查询里必须取不到。
   * 取到了就等于微信用户也能被密码登录爆破 —— 而他们压根没有密码。
   */
  it('没有用户名的小程序用户取不到凭据', async () => {
    const credential = await new PostgresUserRepository(pool).findCredentialByUsername('u-1');
    expect(credential).toBeNull();
  });

  /**
   * `password_hash IS NOT NULL` 那半个条件：只有用户名、没有密码的行
   * （手工建号漏了第二步）绝不该能登录。少了这个条件，`verifyPassword` 会拿到
   * null 并收敛成 false，看起来像密码错，实际上是账号建坏了。
   */
  it('只有用户名、没有密码哈希的行取不到凭据', async () => {
    await inRollback(async ({ db, repo }) => {
      const username = uniq();
      await db.query(`UPDATE users SET username = $1, password_hash = NULL WHERE id = 'u-2'`, [
        username,
      ]);
      expect(await repo.findCredentialByUsername(username)).toBeNull();
    });
  });

  /**
   * 角色列的 CHECK 拦得住乱值 —— 所以「库里是乱值」这种行在真库上造不出来。
   *
   * 仓储里那道白名单筛因此**没法在真库里验**（要先 DROP CONSTRAINT，而那是
   * ACCESS EXCLUSIVE 锁的 DDL，Jest 并行跑的邻居套件正在同几张表上开事务，
   * 两边会等成环 —— global-setup 的注释里记着这个坑）。那一条放在
   * `user-repository.spec.ts` 里用替身验。这里只证 CHECK 真的在拦。
   */
  it('角色列的 CHECK 拦下白名单外的值', async () => {
    await inRollback(async ({ db }) => {
      const username = uniq();
      await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword('a-long-enough-password'),
        role: 'moderator',
      });
      await expect(
        db.query(`UPDATE users SET role = '超级管理员' WHERE username = $1`, [username]),
      ).rejects.toThrow(/check constraint|violates/i);
    });
  });

  /**
   * 用户名精确匹配，不做大小写折叠。
   *
   * 这是**有意的**：折叠要么在写入时做（那要改 upsert 与索引），要么在查询时做
   * （那会让唯一索引失效 —— `Ops` 与 `ops` 能同时存在，登录时却撞成一个）。
   * 现在两处都不折叠，所以两者是不同的账号，且都登得进自己那个。
   */
  it('用户名区分大小写', async () => {
    await inRollback(async ({ db, repo }) => {
      const username = uniq();
      await upsertAdminAccount(db, {
        username,
        passwordHash: await hashPassword('a-long-enough-password'),
        role: 'moderator',
      });
      expect(await repo.findCredentialByUsername(username.toUpperCase())).toBeNull();
    });
  });
});
