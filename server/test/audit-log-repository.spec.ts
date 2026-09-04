import { Pool } from 'pg';
import {
  InMemoryAuditLogRepository,
  PostgresAuditLogRepository,
  type AuditLogEntry,
  type AuditLogRepository,
} from '../src/moderation/audit-log.repository';

/**
 * 双跑：内存实现无条件跑，Postgres 实现由 DATABASE_URL 门控。
 * 同一组用例跑两遍，保证两个实现语义一致 —— 否则「本地绿、上线红」。
 */
const DB_URL = process.env.DATABASE_URL;

const ACTOR = 'u-test-audit-repo';
/** 每个用例都用独立的目标 id，免得并行邻居的流水混进断言。 */
const TARGET = 'po-test-audit-repo';

const entry = (over: Partial<AuditLogEntry> = {}): AuditLogEntry => ({
  actorId: ACTOR,
  action: 'report',
  targetType: 'post',
  targetId: TARGET,
  statusBefore: 'approved',
  statusAfter: 'pending_review',
  ...over,
});

function sharedContract(makeRepo: () => AuditLogRepository, reset: () => Promise<void>): void {
  let repo: AuditLogRepository;

  beforeEach(async () => {
    await reset();
    repo = makeRepo();
  });

  it('append 写入后能按目标查回', async () => {
    await repo.append(entry());
    const rows = await repo.listByTarget('post', TARGET);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('report');
    expect(rows[0].actorId).toBe(ACTOR);
    expect(rows[0].statusBefore).toBe('approved');
    expect(rows[0].statusAfter).toBe('pending_review');
  });

  it('append 生成 id 与 createdAt —— 调用方不用自己造', async () => {
    await repo.append(entry());
    const [row] = await repo.listByTarget('post', TARGET);
    expect(row.id).toBeTruthy();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('listByTarget 按时间倒序 —— 最近的动作在最前', async () => {
    // 一条内容的完整生命周期：被举报 → 复核驳回。
    await repo.append(entry({ action: 'report' }));
    await repo.append(
      entry({ action: 'review_reject', statusBefore: 'pending_review', statusAfter: 'rejected' }),
    );
    const rows = await repo.listByTarget('post', TARGET);
    expect(rows.map((r) => r.action)).toEqual(['review_reject', 'report']);
  });

  it('actorId 为 null 的机审流水也能写 —— 那不是人做的动作', async () => {
    await repo.append(
      entry({ actorId: null, action: 'auto_reject', statusBefore: 'pending', statusAfter: 'rejected' }),
    );
    const [row] = await repo.listByTarget('post', TARGET);
    expect(row.actorId).toBeNull();
    expect(row.action).toBe('auto_reject');
  });

  it('listByTarget 按 (targetType, targetId) 精确匹配，不串目标', async () => {
    await repo.append(entry({ targetId: TARGET }));
    await repo.append(entry({ targetId: `${TARGET}-other` }));
    // 同 id 不同类型也不能串：target_id 是多态的，光比 id 会撞。
    await repo.append(entry({ targetType: 'post_image', targetId: TARGET }));

    expect(await repo.listByTarget('post', TARGET)).toHaveLength(1);
    expect(await repo.listByTarget('post', `${TARGET}-other`)).toHaveLength(1);
    expect(await repo.listByTarget('post_image', TARGET)).toHaveLength(1);
  });

  it('没有流水的目标返回空数组，不是 null', async () => {
    expect(await repo.listByTarget('post', 'po-从未被举报')).toEqual([]);
  });

  /**
   * `list` 是**全局**视图（运营后台的合规页），与 `listByTarget` 的分工是：
   * 前者「最近谁做了什么」，后者「这条内容的历史」。
   */
  it('list 跨目标返回全部流水，按时间倒序', async () => {
    await repo.append(entry({ action: 'report' }));
    await repo.append(entry({ targetType: 'post_image', action: 'review_reject' }));
    const { items } = await repo.list({ page: 1, pageSize: 10 });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(2);
    // 后追加的在前 —— 倒序。
    expect(mine[0].action).toBe('review_reject');
    expect(mine[1].action).toBe('report');
  });

  it('list 带 actorName 字段（值可能是 null）', async () => {
    await repo.append(entry());
    const { items } = await repo.list({ page: 1, pageSize: 10 });
    // 无库实现恒为 null；真库靠 LEFT JOIN 取。两边都必须**有这个键** ——
    // 缺键会让客户端的 `'actorName' in row` 判断出不同结果。
    expect(items[0]).toHaveProperty('actorName');
  });

  /**
   * 机审的流水 `actor_id` 是 NULL，而它们恰恰是最需要留痕的那些 ——
   * 真库那边若写成 `JOIN` 而不是 `LEFT JOIN`，这一条会红。
   */
  it('list 不丢掉没有操作人的流水（机审）', async () => {
    await repo.append(entry({ actorId: null, action: 'auto_reject' }));
    const { items } = await repo.list({ page: 1, pageSize: 10 });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(1);
    expect(mine[0].actorId).toBeNull();
  });

  /**
   * 操作人已注销时也不能丢：`actor_id` 不挂外键（流水必须比主体活得久），
   * 所以「id 指向一个不存在的用户」是正常状态，不是数据损坏。
   */
  it('list 不丢掉操作人已注销的流水', async () => {
    await repo.append(entry({ actorId: 'u-已经不存在了' }));
    const { items } = await repo.list({ page: 1, pageSize: 10 });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(1);
    expect(mine[0].actorId).toBe('u-已经不存在了');
    expect(mine[0].actorName).toBeNull();
  });

  it('list 分页：pageSize 切片，hasMore 靠多取一条判', async () => {
    for (const action of ['report', 'review_approve', 'review_reject'] as const) {
      await repo.append(entry({ action }));
    }
    const page1 = await repo.list({ page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    // 第二页的第一条不能与第一页最后一条重复 —— 页边界重复就是排序不稳定。
    const page2 = await repo.list({ page: 2, pageSize: 2 });
    expect(page2.items[0].id).not.toBe(page1.items[1].id);
  });

  it('list 越界的页返回空列表与 hasMore=false，不是报错', async () => {
    await repo.append(entry());
    const { items, hasMore } = await repo.list({ page: 99, pageSize: 10 });
    expect(items).toEqual([]);
    expect(hasMore).toBe(false);
  });

  /**
   * 筛选：`action` 与 `targetType` 两维。两个实现（内存的谓词与 SQL 的 WHERE）
   * 必须语义一致 —— 这组用例在双跑里各跑一遍，分叉会当场红。
   */
  it('list 按 action 筛', async () => {
    await repo.append(entry({ action: 'report' }));
    await repo.append(entry({ action: 'review_reject' }));
    const { items } = await repo.list({ page: 1, pageSize: 10, filter: { action: 'review_reject' } });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(1);
    expect(mine[0].action).toBe('review_reject');
  });

  it('list 按 targetType 筛，不串多态目标', async () => {
    await repo.append(entry({ targetType: 'post' }));
    await repo.append(entry({ targetType: 'post_image' }));
    const { items } = await repo.list({
      page: 1,
      pageSize: 10,
      filter: { targetType: 'post_image' },
    });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(1);
    expect(mine[0].targetType).toBe('post_image');
  });

  it('两个维度同时给时是「与」关系', async () => {
    await repo.append(entry({ action: 'report', targetType: 'post' }));
    await repo.append(entry({ action: 'report', targetType: 'post_image' }));
    await repo.append(entry({ action: 'review_reject', targetType: 'post_image' }));
    const { items } = await repo.list({
      page: 1,
      pageSize: 10,
      filter: { action: 'report', targetType: 'post_image' },
    });
    const mine = items.filter((r) => r.targetId.startsWith(TARGET));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ action: 'report', targetType: 'post_image' });
  });

  it('不传 filter 时不筛', async () => {
    await repo.append(entry({ action: 'report' }));
    await repo.append(entry({ action: 'review_approve' }));
    const { items } = await repo.list({ page: 1, pageSize: 10 });
    expect(items.filter((r) => r.targetId.startsWith(TARGET))).toHaveLength(2);
  });

  /**
   * **筛选必须在取数时生效，不能取回来再筛** —— 否则 LIMIT 作用在筛之前的行集上，
   * 分页整个算错。这条用「筛完只剩一条，而 pageSize=1 时 hasMore 必须是 false」
   * 来间接证明：若是先取一页再筛，两条里筛掉一条会让 hasMore 仍为 true。
   */
  it('筛选参与分页计算，不是取回来再筛', async () => {
    await repo.append(entry({ action: 'report' }));
    await repo.append(entry({ action: 'review_approve' }));
    const { items, hasMore } = await repo.list({
      page: 1,
      pageSize: 1,
      filter: { action: 'report' },
    });
    expect(items.filter((r) => r.targetId.startsWith(TARGET))).toHaveLength(1);
    expect(hasMore).toBe(false);
  });

  /**
   * Global Constraint 25：流水不可变。接口上**没有** update / delete ——
   * 不给它们留方法就是最强的保证。这条断言钉住这一点，防止将来「顺手」加一个。
   */
  it('接口上没有 update / delete —— 流水只追加', () => {
    const surface = repo as unknown as Record<string, unknown>;
    for (const forbidden of ['update', 'delete', 'remove', 'clear', 'deleteByTarget']) {
      expect(typeof surface[forbidden]).toBe('undefined');
    }
  });
}

describe('InMemoryAuditLogRepository', () => {
  let repo: InMemoryAuditLogRepository;
  sharedContract(
    () => repo,
    async () => {
      repo = new InMemoryAuditLogRepository();
    },
  );
});

const describeDb = DB_URL ? describe : describe.skip;

describeDb('PostgresAuditLogRepository', () => {
  let pool: Pool;

  const wipe = async (): Promise<void> => {
    await pool.query(`DELETE FROM audit_log WHERE target_id LIKE $1`, [`${TARGET}%`]);
  };

  beforeAll(async () => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL, max: 2 });
  });

  afterAll(async () => {
    await wipe();
    await pool.end();
  });

  sharedContract(() => new PostgresAuditLogRepository(pool), wipe);

  /**
   * Global Constraint 24 要求「改状态」与「写流水」原子。`append` 因此接受一个
   * 可选的外部 client，让调用方能把它塞进自己的事务。
   */
  it('append 可以挂在调用方的事务里 —— 事务回滚时流水一起回滚', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const repo = new PostgresAuditLogRepository(pool);
      await repo.append(entry(), client);
      // 事务内可见。
      const inside = await repo.listByTarget('post', TARGET, client);
      expect(inside).toHaveLength(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    // 回滚后不可见 —— 证明它真的在那个事务里，不是走 pool 另开的连接。
    const repo = new PostgresAuditLogRepository(pool);
    expect(await repo.listByTarget('post', TARGET)).toHaveLength(0);
  });

  it('不传 client 时走 pool，与事务无关', async () => {
    const repo = new PostgresAuditLogRepository(pool);
    await repo.append(entry());
    expect(await repo.listByTarget('post', TARGET)).toHaveLength(1);
  });

  /**
   * actor_id 刻意不挂外键（流水必须比它记录的主体活得久）。这条钉住那个取向：
   * 指向已注销用户的流水写得进去。代价是拼错的 actor_id 不会被库拦住，接受。
   */
  it('actorId 指向不存在的用户也能写 —— 流水要比它记录的主体活得久', async () => {
    const repo = new PostgresAuditLogRepository(pool);
    await expect(repo.append(entry({ actorId: 'u-已注销' }))).resolves.toBeUndefined();
    expect((await repo.listByTarget('post', TARGET))[0].actorId).toBe('u-已注销');
  });

  it('非法 action 被库层 CHECK 拦住 —— 类型只管编译期，库层兜运行期', async () => {
    const repo = new PostgresAuditLogRepository(pool);
    await expect(
      repo.append(entry({ action: '删掉' as AuditLogEntry['action'] })),
    ).rejects.toThrow(/check constraint|violates/i);
  });
});
