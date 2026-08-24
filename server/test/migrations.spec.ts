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

  it('建表 SQL 覆盖 5 张业务表与 postgis 扩展', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];
    expect(schema).toContain('CREATE EXTENSION IF NOT EXISTS postgis');
    for (const t of ['users', 'pets', 'pet_photos', 'venue_extras', 'favorites']) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
    }
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
