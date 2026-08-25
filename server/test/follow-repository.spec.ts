import { Pool } from 'pg';
import {
  InMemoryFollowRepository,
  PostgresFollowRepository,
  type FollowRepository,
} from '../src/follows/follow.repository';

/**
 * 双跑：内存实现无条件跑，Postgres 实现由 DATABASE_URL 门控。
 * 同一组用例跑两遍，保证两个实现语义一致 —— 否则「本地绿、上线红」。
 */
const DB_URL = process.env.DATABASE_URL;

const USER_ID = 'u-test-follow-repo';
const OTHER_USER = 'u-test-follow-repo-2';

function sharedContract(makeRepo: () => FollowRepository, reset: () => Promise<void>): void {
  let repo: FollowRepository;

  beforeEach(async () => {
    await reset();
    repo = makeRepo();
  });

  it('follow 幂等：重复关注不产生第二行', async () => {
    await repo.follow(USER_ID, 'p-1');
    await repo.follow(USER_ID, 'p-1');
    const list = await repo.listFollowing(USER_ID, { page: 1, pageSize: 20 });
    expect(list.petIds).toEqual(['p-1']);
    expect(list.hasMore).toBe(false);
  });

  it('unfollow 幂等：取消未关注的不报错', async () => {
    await expect(repo.unfollow(USER_ID, 'p-8')).resolves.toBeUndefined();
    await repo.follow(USER_ID, 'p-2');
    await repo.unfollow(USER_ID, 'p-2');
    await repo.unfollow(USER_ID, 'p-2');
    expect((await repo.listFollowing(USER_ID, { page: 1, pageSize: 20 })).petIds).toEqual([]);
  });

  it('listFollowing 按关注时间倒序 —— 最近关注的在最前', async () => {
    await repo.follow(USER_ID, 'p-1');
    await repo.follow(USER_ID, 'p-2');
    await repo.follow(USER_ID, 'p-3');
    const { petIds } = await repo.listFollowing(USER_ID, { page: 1, pageSize: 20 });
    expect(petIds).toEqual(['p-3', 'p-2', 'p-1']);
  });

  it('listFollowing 分页：hasMore 与不重叠', async () => {
    for (const id of ['p-1', 'p-2', 'p-3', 'p-4']) await repo.follow(USER_ID, id);
    const first = await repo.listFollowing(USER_ID, { page: 1, pageSize: 3 });
    expect(first.petIds).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await repo.listFollowing(USER_ID, { page: 2, pageSize: 3 });
    expect(second.petIds).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(first.petIds).not.toContain(second.petIds[0]);
  });

  it('listFollowing 只看自己的关注，不串号', async () => {
    await repo.follow(USER_ID, 'p-1');
    await repo.follow(OTHER_USER, 'p-2');
    expect((await repo.listFollowing(USER_ID, { page: 1, pageSize: 20 })).petIds).toEqual(['p-1']);
    expect((await repo.listFollowing(OTHER_USER, { page: 1, pageSize: 20 })).petIds).toEqual([
      'p-2',
    ]);
  });

  it('followedAtByPetId 批量查询：一次拿全，避免列表页 N+1', async () => {
    await repo.follow(USER_ID, 'p-1');
    await repo.follow(USER_ID, 'p-3');
    const map = await repo.followedAtByPetId(USER_ID, ['p-1', 'p-2', 'p-3']);
    expect(new Set(map.keys())).toEqual(new Set(['p-1', 'p-3']));
    expect(map.get('p-1')).toBeInstanceOf(Date);
  });

  it('followedAtByPetId 空 id 列表直接回空 Map，不打库', async () => {
    expect((await repo.followedAtByPetId(USER_ID, [])).size).toBe(0);
  });

  it('followingPetIds 返回已关注集合，供批量标记 isFollowing', async () => {
    await repo.follow(USER_ID, 'p-5');
    const ids = await repo.followingPetIds(USER_ID, ['p-4', 'p-5']);
    expect(ids).toEqual(new Set(['p-5']));
  });
}

describe('InMemoryFollowRepository', () => {
  let repo: InMemoryFollowRepository;
  sharedContract(
    () => repo,
    async () => {
      repo = new InMemoryFollowRepository();
    },
  );
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb('PostgresFollowRepository', () => {
  let pool: Pool;

  beforeAll(async () => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    // follows.follower_id 有外键，测试用户得先真实存在。
    for (const id of [USER_ID, OTHER_USER]) {
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [id, `openid-${id}`, '关注仓储测试用户'],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM follows WHERE follower_id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.end();
  });

  sharedContract(
    () => new PostgresFollowRepository(pool),
    async () => {
      await pool.query(`DELETE FROM follows WHERE follower_id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    },
  );

  it('外键生效：关注不存在的宠物被库层拒绝', async () => {
    // 这条防的是阶段 1 踩过的坑 —— 业务层校验漏了，库层得兜住。
    const repo = new PostgresFollowRepository(pool);
    await expect(repo.follow(USER_ID, 'p-does-not-exist')).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });

  it('外键生效：不存在的用户不能关注', async () => {
    const repo = new PostgresFollowRepository(pool);
    await expect(repo.follow('u-ghost', 'p-1')).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });
});
