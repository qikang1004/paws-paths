import { Pool } from 'pg';
import {
  InMemoryFavoritesRepository,
  PostgresFavoritesRepository,
  type FavoritesRepository,
} from '../src/favorites/favorite.repository';

/**
 * 双跑：内存实现无条件跑，Postgres 实现由 DATABASE_URL 门控
 * （与 follow-repository.spec / view-history-repository.spec 同款）。
 *
 * 这张表在阶段 2 被迁成多态（spec §4.2），语义两边必须一致 ——
 * 特别是「重复收藏不刷新时间」这条：它和浏览历史的 DO UPDATE 刚好相反。
 */
const DB_URL = process.env.DATABASE_URL;

const USER_ID = 'u-test-fav-repo';
const OTHER_USER = 'u-test-fav-repo-2';
const page1 = { page: 1, pageSize: 20 };

function sharedContract(makeRepo: () => FavoritesRepository, reset: () => Promise<void>): void {
  let repo: FavoritesRepository;

  beforeEach(async () => {
    await reset();
    repo = makeRepo();
  });

  const ids = async (): Promise<string[]> => {
    const { entries } = await repo.listByUser(USER_ID, page1);
    return entries.map((e) => `${e.targetType}:${e.targetId}`);
  };

  it('add 幂等：同一 (user, type, id) 重复收藏不新增行', async () => {
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'venue', 'v-1');
    expect(await ids()).toEqual(['venue:v-1']);
  });

  it('重复 add 不刷新收藏时间 —— 与浏览历史相反，列表不该因为再点一次而重排', async () => {
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'pet', 'p-1');
    expect(await ids()).toEqual(['pet:p-1', 'venue:v-1']);

    await repo.add(USER_ID, 'venue', 'v-1');
    expect(await ids()).toEqual(['pet:p-1', 'venue:v-1']);
  });

  it('remove 后重新 add 才算新收藏，时间顶到最前', async () => {
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'pet', 'p-1');
    await repo.remove(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'venue', 'v-1');
    expect(await ids()).toEqual(['venue:v-1', 'pet:p-1']);
  });

  it('remove 幂等：取消没收藏过的不报错', async () => {
    await expect(repo.remove(USER_ID, 'pet', 'p-不存在')).resolves.toBeUndefined();
  });

  it('pet 与 venue 的同名 id 互不覆盖 —— 主键带 target_type', async () => {
    // 两类 id 空间独立，理论上可能撞同一个字符串；主键必须是三元组。
    await repo.add(USER_ID, 'pet', 'x-1');
    await repo.add(USER_ID, 'venue', 'x-1');
    expect(await ids()).toEqual(['venue:x-1', 'pet:x-1']);

    await repo.remove(USER_ID, 'pet', 'x-1');
    expect(await ids()).toEqual(['venue:x-1']);
  });

  it('listByUser 混合类型、按收藏时间倒序', async () => {
    await repo.add(USER_ID, 'pet', 'p-1');
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'pet', 'p-3');
    expect(await ids()).toEqual(['pet:p-3', 'venue:v-1', 'pet:p-1']);
  });

  it('listByUser 返回 Date 而不是字符串 —— ISO 化交给上层', async () => {
    await repo.add(USER_ID, 'pet', 'p-1');
    const { entries } = await repo.listByUser(USER_ID, page1);
    expect(entries[0].favoritedAt).toBeInstanceOf(Date);
  });

  it('listByUser 分页：hasMore 与不重叠', async () => {
    for (const id of ['p-1', 'p-2', 'p-3', 'p-4']) await repo.add(USER_ID, 'pet', id);
    const first = await repo.listByUser(USER_ID, { page: 1, pageSize: 3 });
    expect(first.entries).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await repo.listByUser(USER_ID, { page: 2, pageSize: 3 });
    expect(second.entries).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(first.entries.map((e) => e.targetId)).not.toContain(second.entries[0].targetId);
  });

  it('listByUser 空收藏返回空数组而不是报错', async () => {
    const { entries, hasMore } = await repo.listByUser(USER_ID, page1);
    expect(entries).toEqual([]);
    expect(hasMore).toBe(false);
  });

  it('listByUser 只看自己的收藏，不串号', async () => {
    await repo.add(USER_ID, 'pet', 'p-1');
    await repo.add(OTHER_USER, 'pet', 'p-2');
    const mine = await repo.listByUser(USER_ID, page1);
    const theirs = await repo.listByUser(OTHER_USER, page1);
    expect(mine.entries.map((e) => e.targetId)).toEqual(['p-1']);
    expect(theirs.entries.map((e) => e.targetId)).toEqual(['p-2']);
  });

  it('favoriteIds 只回传入 id 中收藏过的那些', async () => {
    await repo.add(USER_ID, 'venue', 'v-1');
    await repo.add(USER_ID, 'venue', 'v-5');
    const hit = await repo.favoriteIds(USER_ID, 'venue', ['v-1', 'v-2', 'v-5']);
    expect(hit).toEqual(new Set(['v-1', 'v-5']));
  });

  it('favoriteIds 按类型隔离 —— 收藏了 pet 不该让同名 venue 亮心', async () => {
    await repo.add(USER_ID, 'pet', 'x-1');
    expect(await repo.favoriteIds(USER_ID, 'venue', ['x-1'])).toEqual(new Set());
    expect(await repo.favoriteIds(USER_ID, 'pet', ['x-1'])).toEqual(new Set(['x-1']));
  });

  it('favoriteIds 空 id 数组直接回空集合', async () => {
    await repo.add(USER_ID, 'pet', 'p-1');
    expect(await repo.favoriteIds(USER_ID, 'pet', [])).toEqual(new Set());
  });
}

describe('InMemoryFavoritesRepository', () => {
  let repo: InMemoryFavoritesRepository;
  sharedContract(
    () => repo,
    async () => {
      repo = new InMemoryFavoritesRepository();
    },
  );
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb('PostgresFavoritesRepository', () => {
  let pool: Pool;

  beforeAll(async () => {
    // 建表、迁移与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    // favorites.user_id 有外键，测试用户得先真实存在。
    for (const id of [USER_ID, OTHER_USER]) {
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [id, `openid-${id}`, '收藏仓储测试用户'],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM favorites WHERE user_id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.end();
  });

  sharedContract(
    () => new PostgresFavoritesRepository(pool),
    async () => {
      await pool.query(`DELETE FROM favorites WHERE user_id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    },
  );

  it('target_id 不设外键 —— 多态目标，收藏来自 POI 的场所也要能落', async () => {
    // 场所 id 来自腾讯 POI，本库的 venue_extras 可能根本没有这一行。
    const repo = new PostgresFavoritesRepository(pool);
    await expect(repo.add(USER_ID, 'venue', 'poi-本库没有')).resolves.toBeUndefined();
  });

  it('target_type 只收 pet/venue —— CHECK 约束兜住脏值', async () => {
    const repo = new PostgresFavoritesRepository(pool);
    await expect(repo.add(USER_ID, 'post' as unknown as 'pet', 'po-1')).rejects.toThrow(
      /violates check constraint/,
    );
  });

  it('外键生效：不存在的用户不能收藏', async () => {
    const repo = new PostgresFavoritesRepository(pool);
    await expect(repo.add('u-ghost', 'pet', 'p-1')).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });
});
