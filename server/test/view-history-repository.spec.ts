import { Pool } from 'pg';
import {
  InMemoryViewHistoryRepository,
  PostgresViewHistoryRepository,
  type ViewHistoryRepository,
} from '../src/history/view-history.repository';

/**
 * 双跑：内存实现无条件跑，Postgres 实现由 DATABASE_URL 门控（与 follow-repository.spec 同款）。
 * 幂等语义（Global Constraint 19）两边必须一致，否则「本地绿、上线红」。
 */
const DB_URL = process.env.DATABASE_URL;

const USER_ID = 'u-test-history-repo';
const OTHER_USER = 'u-test-history-repo-2';

function sharedContract(
  makeRepo: () => ViewHistoryRepository,
  reset: () => Promise<void>,
): void {
  let repo: ViewHistoryRepository;

  beforeEach(async () => {
    await reset();
    repo = makeRepo();
  });

  it('record 幂等：同一 (user, target) 重复浏览不新增行', async () => {
    await repo.record(USER_ID, 'pet', 'p-1');
    await repo.record(USER_ID, 'pet', 'p-1');
    await repo.record(USER_ID, 'pet', 'p-1');
    const { entries } = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(entries).toHaveLength(1);
    expect(entries[0].targetId).toBe('p-1');
  });

  it('record 重复时刷新 viewed_at —— 再看一次要顶到列表最前', async () => {
    await repo.record(USER_ID, 'pet', 'p-1');
    await repo.record(USER_ID, 'pet', 'p-2');
    const before = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(before.entries.map((e) => e.targetId)).toEqual(['p-2', 'p-1']);

    await repo.record(USER_ID, 'pet', 'p-1');
    const after = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(after.entries.map((e) => e.targetId)).toEqual(['p-1', 'p-2']);
    expect(after.entries).toHaveLength(2);
    // 时间确实往后走了，不是只换了排序
    const oldAt = before.entries[1].viewedAt.getTime();
    expect(after.entries[0].viewedAt.getTime()).toBeGreaterThanOrEqual(oldAt);
  });

  it('pet 与 venue 的同名 id 互不覆盖 —— 唯一约束带 target_type', async () => {
    // 两类 id 空间独立，理论上可能撞同一个字符串；唯一键必须是三元组。
    await repo.record(USER_ID, 'pet', 'x-1');
    await repo.record(USER_ID, 'venue', 'x-1');
    const { entries } = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.targetType))).toEqual(new Set(['pet', 'venue']));
  });

  it('list 按 viewed_at 倒序 —— 最近看的在最前', async () => {
    await repo.record(USER_ID, 'pet', 'p-1');
    await repo.record(USER_ID, 'venue', 'v-1');
    await repo.record(USER_ID, 'pet', 'p-3');
    const { entries } = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(entries.map((e) => `${e.targetType}:${e.targetId}`)).toEqual([
      'pet:p-3',
      'venue:v-1',
      'pet:p-1',
    ]);
  });

  it('list 返回 Date 而不是字符串 —— ISO 化交给上层', async () => {
    await repo.record(USER_ID, 'pet', 'p-1');
    const { entries } = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(entries[0].viewedAt).toBeInstanceOf(Date);
  });

  it('list 分页：hasMore 与不重叠', async () => {
    for (const id of ['p-1', 'p-2', 'p-3', 'p-4']) await repo.record(USER_ID, 'pet', id);
    const first = await repo.list(USER_ID, { page: 1, pageSize: 3 });
    expect(first.entries).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await repo.list(USER_ID, { page: 2, pageSize: 3 });
    expect(second.entries).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(first.entries.map((e) => e.targetId)).not.toContain(second.entries[0].targetId);
  });

  it('list 空历史返回空数组而不是报错', async () => {
    const { entries, hasMore } = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    expect(entries).toEqual([]);
    expect(hasMore).toBe(false);
  });

  it('list 只看自己的历史，不串号', async () => {
    await repo.record(USER_ID, 'pet', 'p-1');
    await repo.record(OTHER_USER, 'pet', 'p-2');
    const mine = await repo.list(USER_ID, { page: 1, pageSize: 20 });
    const theirs = await repo.list(OTHER_USER, { page: 1, pageSize: 20 });
    expect(mine.entries.map((e) => e.targetId)).toEqual(['p-1']);
    expect(theirs.entries.map((e) => e.targetId)).toEqual(['p-2']);
  });
}

describe('InMemoryViewHistoryRepository', () => {
  let repo: InMemoryViewHistoryRepository;
  sharedContract(
    () => repo,
    async () => {
      repo = new InMemoryViewHistoryRepository();
    },
  );
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb('PostgresViewHistoryRepository', () => {
  let pool: Pool;

  beforeAll(async () => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL, max: 2 });
    // view_history.user_id 有外键，测试用户得先真实存在。
    for (const id of [USER_ID, OTHER_USER]) {
      await pool.query(
        `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [id, `openid-${id}`, '浏览历史仓储测试用户'],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM view_history WHERE user_id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[USER_ID, OTHER_USER]]);
    await pool.end();
  });

  sharedContract(
    () => new PostgresViewHistoryRepository(pool),
    async () => {
      await pool.query(`DELETE FROM view_history WHERE user_id = ANY($1)`, [
        [USER_ID, OTHER_USER],
      ]);
    },
  );

  it('target_id 不设外键 —— 多态目标，记录已删除的 id 也不该炸', async () => {
    // 宠物被硬删后历史行还在（清理由后台任务/懒过滤负责），库层不该拦。
    const repo = new PostgresViewHistoryRepository(pool);
    await expect(repo.record(USER_ID, 'pet', 'p-已删除')).resolves.toBeUndefined();
  });

  it('target_type 只收 pet/venue —— CHECK 约束兜住脏值', async () => {
    const repo = new PostgresViewHistoryRepository(pool);
    await expect(
      repo.record(USER_ID, 'post' as unknown as 'pet', 'po-1'),
    ).rejects.toThrow(/violates check constraint/);
  });

  it('外键生效：不存在的用户不能写历史', async () => {
    const repo = new PostgresViewHistoryRepository(pool);
    await expect(repo.record('u-ghost', 'pet', 'p-1')).rejects.toThrow(
      /violates foreign key constraint/,
    );
  });
});
