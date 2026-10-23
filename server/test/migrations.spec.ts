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

  it('建表 SQL 覆盖 11 张业务表与 postgis 扩展', async () => {
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
      // 阶段 3
      'audit_log',
      'moderation_tasks',
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

  // 阶段 3 的两张表：audit_log 是不可变流水，moderation_tasks 是待处理队列
  // （spec §4.4 原话「不可互相替代」）。真库断言在 postgres.integration.spec.ts。
  it('audit_log 带齐动作与状态 CHECK，且 actor_id / target_id 都不挂外键', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];
    const create = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS audit_log'));
    const body = create.slice(0, create.indexOf(');'));

    expect(body).toContain(
      "CHECK (action IN ('report','review_approve','review_reject','auto_approve','auto_reject'))",
    );
    expect(body).toContain("CHECK (target_type IN ('post','post_image'))");
    // 迁移前后两个状态都要落，且都受四状态 CHECK 约束。
    expect(body).toContain('status_before TEXT NOT NULL');
    expect(body).toContain('status_after TEXT NOT NULL');
    // 流水必须比它记录的主体活得久：挂外键会在删用户时改写或阻塞一条不可变记录。
    expect(body).not.toContain('actor_id TEXT NOT NULL');
    expect(body).not.toMatch(/actor_id[^,]*REFERENCES/);
    expect(body).not.toMatch(/target_id[^,]*REFERENCES/);
  });

  it('moderation_tasks 的未处理工单有部分唯一索引，这是举报幂等的实现', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];

    // 部分索引而不是整表唯一：同一条内容可以被举报、复核、再被举报第二次。
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS moderation_tasks_open_target_idx\s+ON moderation_tasks \(target_type, target_id\) WHERE result IS NULL/,
    );

    const create = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS moderation_tasks'));
    const body = create.slice(0, create.indexOf(');'));
    // source 保留 spec §4.4 的三个值，即使本阶段机审不入队。
    expect(body).toContain("CHECK (source IN ('wx_auto','user_report','manual'))");
    // result 可空：NULL 即待处理，这是队列语义的载体。
    expect(body).toContain("result TEXT CHECK (result IN ('approved','rejected'))");
    expect(body).not.toContain('result TEXT NOT NULL');
    // 队列不承担合规留痕，运营账号注销后置空指针可接受——与 audit_log 取向不同。
    expect(body).toMatch(/reported_by TEXT REFERENCES users\(id\) ON DELETE SET NULL/);
    expect(body).toMatch(/handled_by TEXT REFERENCES users\(id\) ON DELETE SET NULL/);
  });

  // users 是阶段 1 建的表，阶段 3 只给它加一列 role（Global Constraint 22：只增不改）。
  it('users.role 用 ADD COLUMN IF NOT EXISTS 加列，CHECK 写成列级约束', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];

    // 列级 CHECK 跟着 ADD COLUMN IF NOT EXISTS 一起幂等；ADD CONSTRAINT 没有
    // IF NOT EXISTS，重跑会报重复。所以这里钉住「一句话」的形态。
    expect(schema).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'\s+CHECK \(role IN \('user','moderator','admin'\)\)/,
    );
    // 不许退化成另开一句 ADD CONSTRAINT。
    expect(schema).not.toMatch(/ALTER TABLE users ADD CONSTRAINT/);
    // 加列语句必须在迁移区（所有建表之后）。
    expect(schema.indexOf('ADD COLUMN IF NOT EXISTS role')).toBeGreaterThan(
      schema.indexOf('-- ── 既有表的迁移'),
    );
  });

  /**
   * 运营账号的登录凭据（阶段 4：独立 Web 后台）。
   *
   * 两列都**允许 NULL**：小程序用户走微信登录，压根没有用户名与密码。
   * 只有运营账号会有值，所以这不是「给所有用户加密码」——那会变成一条
   * 全新的、不该存在的攻击面。
   */
  it('users 加 username / password_hash 两列，都允许 NULL', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];

    // 同 role 那句：ADD COLUMN IF NOT EXISTS 自带幂等，不另开 ADD CONSTRAINT。
    expect(schema).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT/);
    expect(schema).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT/);
    // **不能** NOT NULL：既有 8 个种子用户与所有小程序用户都没有这两样，
    // 加 NOT NULL 会让迁移在有数据的旧库上直接失败。
    expect(schema).not.toMatch(/username TEXT NOT NULL/);
    expect(schema).not.toMatch(/password_hash TEXT NOT NULL/);

    // 用户名唯一，但**只约束非 NULL 的行** —— 部分唯一索引，否则一堆
    // NULL 会被当成重复值（Postgres 的 UNIQUE 允许多个 NULL，但显式写清更好读，
    // 且这个索引同时是登录查询的索引）。
    expect(schema).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS users_username_idx\s+ON users \(username\) WHERE username IS NOT NULL/,
    );

    // 两列都在迁移区（所有建表之后）。
    expect(schema.indexOf('ADD COLUMN IF NOT EXISTS username')).toBeGreaterThan(
      schema.indexOf('-- ── 既有表的迁移'),
    );
  });

  it('手机号加密存储：装 pgcrypto，users 加 phone_enc BYTEA 与 phone_hash，都允许 NULL', async () => {
    const { pool, queries } = fakePool();
    await runMigrations(pool);
    const schema = businessSql(queries)[0];

    // spec §4.5 第 4 条：phone_enc 用 pgcrypto 加密存储。
    expect(schema).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto;/);
    expect(schema).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_enc BYTEA;/);
    // 查找列只存 HMAC-SHA256 的十六进制串，列级 CHECK 钉死形状 —— 防止哪天有人
    // 图省事往这里塞明文手机号。
    expect(schema).toMatch(
      /ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_hash TEXT\s+CHECK \(phone_hash ~ '\^\[0-9a-f\]\{64\}\$'\);/,
    );
    // 不能 NOT NULL：既有用户都没有手机号。
    expect(schema).not.toMatch(/phone_enc BYTEA NOT NULL/);
    expect(schema).not.toMatch(/phone_hash TEXT NOT NULL/);
    // 不存在明文列。
    expect(schema).not.toMatch(/\bphone TEXT/);
    expect(schema).toMatch(
      /CREATE INDEX IF NOT EXISTS users_phone_hash_idx\s+ON users \(phone_hash\) WHERE phone_hash IS NOT NULL/,
    );

    // 扩展在用到它之前装；列在迁移区（所有建表之后）。
    const migrationStart = schema.indexOf('-- ── 既有表的迁移');
    expect(schema.indexOf('ADD COLUMN IF NOT EXISTS phone_enc')).toBeGreaterThan(migrationStart);
    expect(schema.indexOf('CREATE EXTENSION IF NOT EXISTS pgcrypto')).toBeLessThan(
      schema.indexOf('ADD COLUMN IF NOT EXISTS phone_enc'),
    );
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
