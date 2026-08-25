import type { Pool } from 'pg';
import { runMigrations, shouldSeed } from '../src/database/migrations';

/**
 * 迁移编排的单元测试：不碰真库，用假 Pool 记录收到的 SQL。
 * 真库断言在 postgres.integration.spec.ts（DATABASE_URL 门控）。
 */
function fakePool(): { pool: Pool; queries: string[]; released: () => number } {
  const queries: string[] = [];
  let releaseCount = 0;
  // 咨询锁是会话级的，必须落在同一条连接上，所以迁移走 connect() 而不是 pool.query()。
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
    release: () => {
      releaseCount += 1;
    },
  };
  const pool = {
    connect: async () => client,
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
  } as unknown as Pool;
  return { pool, queries, released: () => releaseCount };
}

describe('shouldSeed', () => {
  it('只有 SEED_DEMO_DATA=1 才灌演示数据', () => {
    expect(shouldSeed('1')).toBe(true);
    expect(shouldSeed('0')).toBe(false);
    expect(shouldSeed('')).toBe(false);
    expect(shouldSeed(undefined)).toBe(false);
  });

  it('true / yes 这类近义写法一律不算开启，避免误灌生产库', () => {
    expect(shouldSeed('true')).toBe(false);
    expect(shouldSeed('yes')).toBe(false);
  });
});

describe('runMigrations', () => {
  /** 剔掉锁的加解锁语句，只留业务 SQL，方便沿用原有断言。 */
  const businessSql = (queries: string[]): string[] =>
    queries.filter((q) => !q.includes('pg_advisory'));

  it('默认只建表，不插演示数据', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const sql = businessSql(queries);
    expect(sql).toHaveLength(1);
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS pets');
    expect(sql[0]).not.toContain('INSERT INTO pets');
  });

  it('显式要求时才追加 seed，且顺序在建表之后', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool, { seed: true });
    const sql = businessSql(queries);
    expect(sql).toHaveLength(2);
    expect(sql[0]).toContain('CREATE TABLE IF NOT EXISTS pets');
    expect(sql[1]).toContain('INSERT INTO pets');
  });

  it('建表 SQL 覆盖 9 张业务表与 postgis 扩展', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];
    expect(schema).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    for (const t of [
      // 阶段 1
      'users',
      'pets',
      'pet_photos',
      'venue_extras',
      'favorites',
      // 阶段 2
      'follows',
      'view_history',
      'posts',
      'post_images',
    ]) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
  });

  // 阶段 2 新表的关键约束在建表 SQL 里就该看得见，真库断言在
  // postgres.integration.spec.ts。这里防的是「表建了但约束漏了」。
  it('阶段 2 新表带齐唯一约束与审核状态 CHECK', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];

    // follows：同一人不能重复关注同一只宠物
    expect(schema).toContain('UNIQUE (follower_id, target_pet_id)');
    // view_history：按 (user, target) 幂等更新时间戳，靠唯一约束支撑 ON CONFLICT
    expect(schema).toContain('UNIQUE (user_id, target_type, target_id)');
    // 审核状态机的四个状态（spec §4.5），posts 与 post_images 各一份
    const auditCheck = /CHECK \(audit_status IN \('pending', ?'approved', ?'pending_review', ?'rejected'\)\)/g;
    expect(schema.match(auditCheck)).toHaveLength(2);
    // 图片宽高为瀑布流预估高度而存在，spec §4.1 明确非可选
    expect(schema).toContain('width INTEGER NOT NULL CHECK (width > 0)');
    expect(schema).toContain('height INTEGER NOT NULL CHECK (height > 0)');
  });

  // favorites 是阶段 1 建的表，阶段 2 要把它从「只支持场所」改成多态
  // （spec §4.2）。这是「只增不改」的有意例外，所以约束写得比别的表细：
  // 新库直接建成多态形状，旧库靠 DO 块迁移，两条路都要在 SQL 里看得见。
  it('favorites 建成多态形状（target_type/target_id），且不再有 poi_id', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];
    const create = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS favorites'));
    const body = create.slice(0, create.indexOf(');'));
    expect(body).toContain("target_type TEXT NOT NULL CHECK (target_type IN ('pet','venue'))");
    expect(body).toContain('target_id TEXT NOT NULL');
    expect(body).toContain('PRIMARY KEY (user_id, target_type, target_id)');
    expect(body).not.toContain('poi_id');
  });

  it('旧库的 favorites 迁移可反复执行：先回填再上约束，最后才丢 poi_id', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];
    const migration = schema.slice(schema.indexOf('-- favorites 多态化'));

    // 整段包在「poi_id 还在吗」的判断里：新库根本没这列，进去就会因为
    // UPDATE ... = poi_id 解析不到列而炸。
    expect(migration).toContain("column_name = 'poi_id'");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS target_type');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS target_id');

    // 顺序是硬要求：回填 → SET NOT NULL → 换主键 → DROP COLUMN。
    // 反了任何一步，有数据的旧库都会迁移失败。
    const at = (needle: string): number => migration.indexOf(needle);
    expect(at("SET target_type = 'venue'")).toBeGreaterThan(-1);
    expect(at("SET target_type = 'venue'")).toBeLessThan(at('SET NOT NULL'));
    expect(at('SET NOT NULL')).toBeLessThan(at('ADD PRIMARY KEY'));
    expect(at('ADD PRIMARY KEY')).toBeLessThan(at('DROP COLUMN poi_id'));
  });

  // 多副本部署时每个副本都会跑迁移，并发建表/灌种子会互相踩（远程库上表现为
  // Connection terminated unexpectedly）。用会话级咨询锁把迁移串行化。
  it('迁移包在咨询锁里，且顺序是 加锁 → 业务 SQL → 解锁', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool, { seed: true });
    expect(queries[0]).toContain('pg_advisory_lock');
    expect(queries[queries.length - 1]).toContain('pg_advisory_unlock');
    expect(businessSql(queries)).toHaveLength(2);
  });

  it('业务 SQL 抛错也要解锁并归还连接，否则锁会一直挂住后续副本', async () => {
    const { pool, released } = fakePool();
    const boom = new Error('建表炸了');
    // 让第二条业务 SQL（seed）失败。
    let n = 0;
    const client = await (pool as unknown as { connect: () => Promise<{ query: unknown }> }).connect();
    (client as { query: (sql: string) => Promise<unknown> }).query = async (sql: string) => {
      if (sql.includes('pg_advisory')) return { rows: [] };
      n += 1;
      if (n === 2) throw boom;
      return { rows: [] };
    };
    await expect(runMigrations(pool, { seed: true })).rejects.toThrow('建表炸了');
    expect(released()).toBe(1);
  });
});
