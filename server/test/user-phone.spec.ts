import { randomBytes, randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import { ApiException } from '../src/common/api.exception';
import { phoneLookupHash } from '../src/users/phone-crypto';
import {
  InMemoryUserRepository,
  PostgresUserRepository,
  type UserRepository,
} from '../src/users/user.repository';
import { UsersService } from '../src/users/users.service';

/**
 * 手机号加密存储（spec §4.5 第 4 条：`phone_enc` 用 pgcrypto 加密，接口一律脱敏）。
 *
 * 钥匙都是本文件现生成的随机串，不是任何环境里的真值；用完把环境变量还原。
 */
const testKey = (): string => randomBytes(32).toString('hex');
const PHONE = '13800138000';

function withPhoneKeys(): { encKey: string; hashKey: string } {
  const keys = { encKey: testKey(), hashKey: testKey() };
  const saved = { enc: process.env.PHONE_ENC_KEY, hash: process.env.PHONE_HASH_KEY };
  beforeEach(() => {
    process.env.PHONE_ENC_KEY = keys.encKey;
    process.env.PHONE_HASH_KEY = keys.hashKey;
  });
  afterEach(() => {
    if (saved.enc === undefined) delete process.env.PHONE_ENC_KEY;
    else process.env.PHONE_ENC_KEY = saved.enc;
    if (saved.hash === undefined) delete process.env.PHONE_HASH_KEY;
    else process.env.PHONE_HASH_KEY = saved.hash;
  });
  return keys;
}

/** 两种实现共用的仓储契约。 */
function phoneRepoContract(
  name: string,
  run: (fn: (repo: UserRepository, db: PoolClient | null) => Promise<void>) => Promise<void>,
): void {
  describe(`${name}：手机号仓储契约`, () => {
    const encKey = testKey();
    const hashKey = testKey();

    it('没绑过手机号的用户取回 null；不存在的用户也是 null', async () => {
      await run(async (repo) => {
        const user = await repo.create(`phone-it-${randomUUID()}`);
        expect(await repo.findPhone(user.id, encKey)).toBeNull();
        expect(await repo.findPhone(randomUUID(), encKey)).toBeNull();
      });
    });

    it('写进去能原样解回，按查找哈希能找回这个用户', async () => {
      await run(async (repo) => {
        const user = await repo.create(`phone-it-${randomUUID()}`);
        const lookupHash = phoneLookupHash(PHONE, hashKey);
        expect(await repo.setPhone(user.id, { phone: PHONE, lookupHash }, encKey)).toBe(true);
        expect(await repo.findPhone(user.id, encKey)).toBe(PHONE);
        expect(await repo.findIdByPhoneHash(lookupHash)).toBe(user.id);
        expect(await repo.findIdByPhoneHash(phoneLookupHash('13900139000', hashKey))).toBeNull();
      });
    });

    it('不存在的用户写不进去，返回 false', async () => {
      await run(async (repo) => {
        const lookupHash = phoneLookupHash(PHONE, hashKey);
        expect(await repo.setPhone(randomUUID(), { phone: PHONE, lookupHash }, encKey)).toBe(false);
      });
    });

    it('改绑覆盖旧号：旧号的哈希不再指向这个用户', async () => {
      await run(async (repo) => {
        const user = await repo.create(`phone-it-${randomUUID()}`);
        const oldHash = phoneLookupHash(PHONE, hashKey);
        const next = '13900139000';
        await repo.setPhone(user.id, { phone: PHONE, lookupHash: oldHash }, encKey);
        await repo.setPhone(user.id, { phone: next, lookupHash: phoneLookupHash(next, hashKey) }, encKey);
        expect(await repo.findPhone(user.id, encKey)).toBe(next);
        expect(await repo.findIdByPhoneHash(oldHash)).toBeNull();
      });
    });
  });
}

phoneRepoContract('InMemoryUserRepository', async (fn) => fn(new InMemoryUserRepository(), null));

describe('UsersService 手机号', () => {
  const keys = withPhoneKeys();
  let repo: InMemoryUserRepository;
  let service: UsersService;

  beforeEach(() => {
    repo = new InMemoryUserRepository();
    service = new UsersService(repo);
  });

  it('绑定后只回脱敏形式；仓储里存的是规范化后的号', async () => {
    const user = await repo.create('svc-phone-1');
    expect(await service.bindPhone(user.id, '+86 138 0013 8000')).toEqual({
      phoneMasked: '138****8000',
    });
    expect(await service.maskedPhone(user.id)).toBe('138****8000');
    expect(await repo.findPhone(user.id, keys.encKey)).toBe(PHONE);
  });

  it('查找哈希用的是 PHONE_HASH_KEY：按号能找回用户，写法不同的同一个号也能', async () => {
    const user = await repo.create('svc-phone-2');
    await service.bindPhone(user.id, PHONE);
    expect(await service.findUserIdByPhone('138-0013-8000')).toBe(user.id);
    expect(await repo.findIdByPhoneHash(phoneLookupHash(PHONE, keys.hashKey))).toBe(user.id);
    expect(await service.findUserIdByPhone('13900139000')).toBeNull();
    // 不是手机号的输入直接 null，不去查库。
    expect(await service.findUserIdByPhone('not-a-phone')).toBeNull();
  });

  it('没绑过就是 null', async () => {
    const user = await repo.create('svc-phone-3');
    expect(await service.maskedPhone(user.id)).toBeNull();
  });

  it('非法手机号 422，不落库', async () => {
    const user = await repo.create('svc-phone-4');
    await expect(service.bindPhone(user.id, '12345')).rejects.toMatchObject({
      status: 422,
    });
    expect(await service.maskedPhone(user.id)).toBeNull();
  });

  it('用户不存在 404', async () => {
    await expect(service.bindPhone(randomUUID(), PHONE)).rejects.toBeInstanceOf(ApiException);
    await expect(service.bindPhone(randomUUID(), PHONE)).rejects.toMatchObject({ status: 404 });
  });

  it('钥匙没配：报缺哪个变量，不静默存明文', async () => {
    const user = await repo.create('svc-phone-5');
    delete process.env.PHONE_ENC_KEY;
    await expect(service.bindPhone(user.id, PHONE)).rejects.toThrow(/PHONE_ENC_KEY/);
    await expect(service.maskedPhone(user.id)).rejects.toThrow(/PHONE_ENC_KEY/);
  });
});

const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('PostgresUserRepository 手机号（真库）', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: DB_URL, max: 2 });
  });

  afterAll(async () => {
    await pool.end();
  });

  /** 事务里跑再回滚：共享库，本套件写 users 表（同 admin-account.integration.spec 的理由）。 */
  const inRollback = async (
    fn: (repo: UserRepository, db: PoolClient) => Promise<void>,
  ): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(new PostgresUserRepository(client as unknown as Pool), client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  phoneRepoContract('PostgresUserRepository', async (fn) =>
    inRollback(async (repo, db) => fn(repo, db)),
  );

  it('落库的 phone_enc 是 pgcrypto 密文：bytea、不含明文；phone_hash 是 64 位十六进制', async () => {
    await inRollback(async (repo, db) => {
      const encKey = testKey();
      const user = await repo.create(`phone-it-${randomUUID()}`);
      const lookupHash = phoneLookupHash(PHONE, testKey());
      await repo.setPhone(user.id, { phone: PHONE, lookupHash }, encKey);
      const { rows } = await db.query<{ enc: Buffer; hash: string; t: string }>(
        `SELECT phone_enc AS enc, phone_hash AS hash, pg_typeof(phone_enc)::text AS t
           FROM users WHERE id = $1`,
        [user.id],
      );
      expect(rows[0].t).toBe('bytea');
      expect(rows[0].enc.toString('latin1')).not.toContain(PHONE);
      expect(rows[0].hash).toBe(lookupHash);
    });
  });

  it('拿错钥匙解不开（pgcrypto 报错），不会给出一个看似合法的号', async () => {
    await inRollback(async (repo) => {
      const user = await repo.create(`phone-it-${randomUUID()}`);
      await repo.setPhone(user.id, { phone: PHONE, lookupHash: phoneLookupHash(PHONE, testKey()) }, testKey());
      await expect(repo.findPhone(user.id, testKey())).rejects.toThrow();
    });
  });
});
