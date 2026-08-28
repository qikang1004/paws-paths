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
