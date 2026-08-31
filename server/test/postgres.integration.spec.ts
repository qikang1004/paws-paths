import { Pool } from 'pg';

/**
 * PostGIS 集成测试：以 DATABASE_URL 存在为门控（与 REDIS_INTEGRATION 同款）。
 * 无数据库环境优雅跳过；设了 DATABASE_URL 且数据库就绪时全量跑真库断言。
 * 本机起库：docker compose up -d（postgis + redis，见仓库根 docker-compose.yml）。
 */
const DB_URL = process.env.DATABASE_URL;
const describeDb = DB_URL ? describe : describe.skip;

describeDb('postgres integration', () => {
  // 远程库下默认的 5000ms 兜不住多往返的用例（notes #22）：外键探针那条一个用例
  // 要插三次、回滚三次，单次热连接 ~600ms 起。jest.config.js 里已经把 testTimeout
  // 提到 30s，这里留着是为了单独 `-t` 跑这个文件时也有同样的余量。
  jest.setTimeout(30_000);

  let pool: Pool;

  beforeAll(() => {
    // 建表与种子由 test/global-setup.ts 全局跑一次。
    pool = new Pool({ connectionString: DB_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('建出 11 张业务表', async () => {
    const { rows } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const names = rows.map((r) => r.tablename);
    for (const t of [
      'users',
      'pets',
      'pet_photos',
      'venue_extras',
      'favorites',
      'follows',
      'view_history',
      'posts',
      'post_images',
      'audit_log',
      'moderation_tasks',
    ]) {
      expect(names).toContain(t);
    }
  });

  /**
   * 在事务里跑探针再回滚：本组好几条要**插入成功**才能验（部分唯一索引得先有一条
   * 未处理工单占位），而这个库是共享的远程实例，留下的行会让后面的走查数不清。
   * 既有那些探针都是「插入必失败」，失败本身就不留数据，所以它们不需要这个。
   */
  const inRollback = async (fn: (c: import('pg').PoolClient) => Promise<void>): Promise<void> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await fn(client);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  };

  describe('阶段 2 新表的约束（真库层面）', () => {
    it('follows 的 (follower_id, target_pet_id) 唯一约束真实生效', async () => {
      // 幂等关注依赖它兜底：ON CONFLICT DO NOTHING 需要这个约束才有落点。
      // 基线自带，不借种子的 f-1：万一别的套件把它清了，这条会「插入成功」，
      // 于是探针行永久占住 (u-1,p-2)，后面每次 seed.sql 都撞唯一约束。
      await pool.query(
        `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ('f-uniq-base','u-1','p-2')
         ON CONFLICT DO NOTHING`,
      );
      const dup = pool.query(
        `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1,'u-1','p-2')`,
        ['f-dup-probe'],
      );
      await expect(dup).rejects.toThrow(/duplicate key|unique/i);
      // 种子行在时上面是空操作，这里也就删不到东西；表回到进来时的样子。
      await pool.query(`DELETE FROM follows WHERE id = 'f-uniq-base'`);
    });

    it('view_history 的 (user_id, target_type, target_id) 唯一约束支撑幂等更新', async () => {
      const before = await pool.query(
        `SELECT viewed_at FROM view_history WHERE user_id='u-1' AND target_type='pet' AND target_id='p-3'`,
      );
      expect(before.rows.length).toBe(1);

      // 幂等写入：冲突时只更新时间戳，不新增行
      await pool.query(
        `INSERT INTO view_history (id, user_id, target_type, target_id) VALUES ($1,'u-1','pet','p-3')
         ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET viewed_at = now()`,
        ['vh-probe'],
      );

      const after = await pool.query(
        `SELECT count(*)::int AS c, max(viewed_at) AS t FROM view_history
         WHERE user_id='u-1' AND target_type='pet' AND target_id='p-3'`,
      );
      expect(after.rows[0].c).toBe(1);
      expect(new Date(after.rows[0].t).getTime()).toBeGreaterThan(
        new Date(before.rows[0].viewed_at).getTime(),
      );
    });

    it('audit_status 的 CHECK 拦下非法状态值', async () => {
      const bad = pool.query(
        `INSERT INTO posts (id, pet_id, author_id, content, audit_status)
         VALUES ($1,'p-1','u-1','x','不存在的状态')`,
        ['po-bad-probe'],
      );
      await expect(bad).rejects.toThrow(/check constraint|violates/i);
    });

    it('post_images 的宽高必须为正（瀑布流预估高度依赖它）', async () => {
      const bad = pool.query(
        `INSERT INTO post_images (id, post_id, url, width, height)
         VALUES ($1,'po-1','http://x/y.jpg',0,100)`,
        ['pi-bad-probe'],
      );
      await expect(bad).rejects.toThrow(/check constraint|violates/i);
    });

    it('posts 的可见性查询路径有复合索引', async () => {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = 'posts' AND indexname = 'posts_pet_visible_idx'`,
      );
      expect(rows.length).toBe(1);
    });

    it('follows / posts 的外键要求用户与宠物真实存在', async () => {
      await expect(
        pool.query(`INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1,'u-1','p-不存在')`, [
          'f-fk-probe',
        ]),
      ).rejects.toThrow(/foreign key/i);
      await expect(
        pool.query(
          `INSERT INTO posts (id, pet_id, author_id, content) VALUES ($1,'p-1','u-不存在','x')`,
          ['po-fk-probe'],
        ),
      ).rejects.toThrow(/foreign key/i);
    });
  });

  // 阶段 3 的三处变更（spec §4.4）。单元测试只能证明 SQL 文本长什么样，
  // 「约束真的生效」「部分索引真的只约束未处理的行」都得在真库上验。
  describe('阶段 3 的审核流水与工单队列（真库层面）', () => {
    it('users.role 加列成功，既有用户自动落 user，非法值被拦', async () => {
      const { rows } = await pool.query<{ role: string; n: string }>(
        `SELECT role, count(*)::text AS n FROM users GROUP BY role`,
      );
      // 不写死总数（种子之外可能有走查留下的用户），只钉「都是合法值且有 user」。
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(['user', 'moderator', 'admin']).toContain(r.role);
      expect(rows.some((r) => r.role === 'user')).toBe(true);

      await inRollback(async (c) => {
        await expect(
          c.query(`UPDATE users SET role = '超级管理员' WHERE id = 'u-1'`),
        ).rejects.toThrow(/check constraint|violates/i);
      });
    });

    it('种子里有一个 moderator，供复核端点的测试与走查用', async () => {
      const { rows } = await pool.query<{ role: string }>(
        `SELECT role FROM users WHERE id = 'u-mod'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].role).toBe('moderator');
    });

    /**
     * 运营账号的登录凭据（阶段 4）。两列都允许 NULL，所以既有用户不受影响 ——
     * 这一条只有真库能证：单元测试只看得到 SQL 文本长什么样。
     */
    it('users.username / password_hash 加列成功，既有用户两列都是 NULL', async () => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM users
          WHERE id ~ '^u-[0-9]+$' AND (username IS NOT NULL OR password_hash IS NOT NULL)`,
      );
      // 只数种子前缀的行（走查会留下别的用户）。小程序用户不该有这两样。
      expect(rows[0].n).toBe('0');
    });

    it('username 的唯一索引只约束非 NULL 的行', async () => {
      await inRollback(async (c) => {
        // 多行 NULL 共存 —— 所有小程序用户都是这种状态，撞了就等于迁移不可用。
        await c.query(`UPDATE users SET username = NULL WHERE id IN ('u-1','u-2')`);
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM users WHERE username IS NULL`,
        );
        expect(Number(rows[0].n)).toBeGreaterThanOrEqual(2);

        // 同一个非 NULL 用户名插两次必须撞。
        await c.query(`UPDATE users SET username = 'ops-probe' WHERE id = 'u-1'`);
        await expect(
          c.query(`UPDATE users SET username = 'ops-probe' WHERE id = 'u-2'`),
        ).rejects.toThrow(/duplicate key|unique/i);
      });
    });

    it('audit_log 的 action 与 target_type CHECK 拦下非法值', async () => {
      await inRollback(async (c) => {
        await expect(
          c.query(
            `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, status_before, status_after)
             VALUES ('al-probe','u-1','删掉','post','po-1','approved','rejected')`,
          ),
        ).rejects.toThrow(/check constraint|violates/i);
      });
      await inRollback(async (c) => {
        await expect(
          c.query(
            `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, status_before, status_after)
             VALUES ('al-probe','u-1','report','pet_photo','pp-1','approved','pending_review')`,
          ),
        ).rejects.toThrow(/check constraint|violates/i);
      });
    });

    it('audit_log 的 actor_id 可空且不挂外键——机审没有操作人，流水要比主体活得久', async () => {
      await inRollback(async (c) => {
        // actor_id 为 NULL：机审的流水。
        await c.query(
          `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, status_before, status_after)
           VALUES ('al-auto-probe',NULL,'auto_reject','post','po-1','pending','rejected')`,
        );
        // actor_id 指向不存在的用户也能写进去：没有外键。代价是拼错不会被库拦住，接受。
        await c.query(
          `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, status_before, status_after)
           VALUES ('al-ghost-probe','u-已注销','report','post','po-1','approved','pending_review')`,
        );
        const { rows } = await c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM audit_log WHERE id IN ('al-auto-probe','al-ghost-probe')`,
        );
        expect(rows[0].n).toBe('2');
      });
    });

    it('部分唯一索引只约束未处理的工单：同目标可以被举报、复核、再举报', async () => {
      await inRollback(async (c) => {
        const ins = (id: string, result: string | null): Promise<unknown> =>
          c.query(
            `INSERT INTO moderation_tasks (id, target_type, target_id, source, reported_by, result, handled_by, handled_at)
             VALUES ($1,'post','po-idx-probe','user_report','u-1',$2,
                     CASE WHEN $2::text IS NULL THEN NULL ELSE 'u-mod' END,
                     CASE WHEN $2::text IS NULL THEN NULL ELSE now() END)`,
            [id, result],
          );

        // 已处理的工单不受约束：同一目标可以有任意多条历史。
        await ins('mt-done-1', 'approved');
        await ins('mt-done-2', 'rejected');
        // 未处理的只能有一条。
        await ins('mt-open-1', null);
        await expect(ins('mt-open-2', null)).rejects.toThrow(/duplicate key|unique/i);
      });
    });

    it('moderation_tasks 的 result 与 source CHECK 生效', async () => {
      await inRollback(async (c) => {
        await expect(
          c.query(
            `INSERT INTO moderation_tasks (id, target_type, target_id, source, result)
             VALUES ('mt-probe','post','po-1','user_report','待定')`,
          ),
        ).rejects.toThrow(/check constraint|violates/i);
      });
      await inRollback(async (c) => {
        await expect(
          c.query(
            `INSERT INTO moderation_tasks (id, target_type, target_id, source)
             VALUES ('mt-probe','post','po-1','管理员随手点的')`,
          ),
        ).rejects.toThrow(/check constraint|violates/i);
      });
    });

    it('两张表的查询路径都有索引：流水按目标查、队列按创建时间取', async () => {
      const { rows } = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename IN ('audit_log','moderation_tasks')`,
      );
      const names = rows.map((r) => r.indexname);
      for (const idx of [
        'audit_log_target_idx',
        'audit_log_actor_idx',
        'moderation_tasks_open_target_idx',
        'moderation_tasks_queue_idx',
      ]) {
        expect(names).toContain(idx);
      }
    });
  });

  // favorites 是阶段 1 建的表，阶段 2 迁成多态（spec §4.2）。「只增不改」的有意例外，
  // 所以这里在真库上确认迁移落地了 —— 单元测试只能证明 SQL 文本长什么样。
  describe('favorites 多态化迁移（真库层面）', () => {
    it('列变成 target_type/target_id，poi_id 已删除', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'favorites'`,
      );
      const names = rows.map((r) => r.column_name);
      expect(names).toContain('target_type');
      expect(names).toContain('target_id');
      // 值已经进 target_id，留着就是第二份真相。
      expect(names).not.toContain('poi_id');
    });

    it('主键换成三元组 (user_id, target_type, target_id)', async () => {
      // 阶段 1 是 (user_id, poi_id)：那个主键既挡着 DROP COLUMN，
      // 也让「同名的 pet 和 venue」互相覆盖。
      // attname 是 name 类型，node-pg 没有 name[] 的解析器（会原样回字符串），
      // 所以在 SQL 里就 ::text 掉。
      const { rows } = await pool.query<{ cols: string[] }>(
        `SELECT array_agg(a.attname::text ORDER BY k.ord) AS cols
         FROM pg_constraint c
         JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         WHERE c.conrelid = 'favorites'::regclass AND c.contype = 'p'`,
      );
      expect(rows[0].cols).toEqual(['user_id', 'target_type', 'target_id']);
    });

    it('target_type 的 CHECK 拦下 pet/venue 之外的值', async () => {
      const bad = pool.query(
        `INSERT INTO favorites (user_id, target_type, target_id) VALUES ('u-1','post','po-1')`,
      );
      await expect(bad).rejects.toThrow(/check constraint|violates/i);
    });

    it('列表查询路径有 (user_id, created_at DESC) 索引', async () => {
      const { rows } = await pool.query(
        `SELECT 1 FROM pg_indexes WHERE tablename = 'favorites' AND indexname = 'favorites_user_idx'`,
      );
      expect(rows.length).toBe(1);
    });
  });

  it('postgis 扩展可用且 pets.location 有 GiST 索引', async () => {
    const { rows } = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'postgis'`,
    );
    expect(rows.length).toBe(1);
    // pg_indexes.indexdef 里的方法名是小写 gist，用 ILIKE 而不是大小写敏感的 LIKE。
    const idx = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = 'pets' AND indexdef ILIKE '%USING gist%'`,
    );
    expect(idx.rows.length).toBe(1);
  });

  // 只数种子行（id 形如 u-1 / p-1 / v-1），不数全表：别的套件会插自己的测试用户，
  // 写死全表行数会让这条断言随邻居的数据起伏。
  it('seed 后 8 只宠物、10 家场所、8 位主人，以及阶段 2 的关系数据', async () => {
    const seeded = [
      ['pets', 'p-', 8],
      ['venue_extras', 'v-', 10],
      ['users', 'u-', 8],
      // 阶段 2
      ['follows', 'f-', 3],
      ['view_history', 'vh-', 4],
      ['posts', 'po-', 5],
      ['post_images', 'pi-', 6],
    ] as const;
    for (const [table, prefix, n] of seeded) {
      const col = table === 'venue_extras' ? 'poi_id' : 'id';
      const { rows } = await pool.query(
        `SELECT count(*)::int AS c FROM ${table} WHERE ${col} ~ ('^' || $1 || '[0-9]+$')`,
        [prefix],
      );
      expect(rows[0].c).toBe(n);
    }
  });

  /**
   * 幂等的证据分两半，都不在这个用例里再跑一遍迁移。
   *
   * 「重复执行不报错」由 `test/global-setup.ts` 承担：那里连着跑两遍 `runMigrations`，
   * 报错就是全局 setup 失败，整轮红得比这里更响。之所以必须放在那儿 —— 那是整轮
   * 唯一没有并发的时刻：schema 的 DDL 要 ACCESS EXCLUSIVE 锁，在用例里跑会和
   * Jest 并行的邻居套件的事务等成环，`deadlock detected`（真库回归上复现过两次，
   * 单跑本套件永远绿）。迁移里的咨询锁只让多次迁移互相排队，管不住普通业务流量。
   *
   * 「种子不会被灌重」由上一条计数断言与这里的 id 集合断言承担：种子已经跑过两遍，
   * 行数与 id 都还对得上，就说明 ON CONFLICT 那层真的兜住了。用 id 集合而不是
   * 行数，是因为「插重」在带唯一约束的表上会先变成 id 冲突 —— 集合对得上，
   * 顺带证明没有 f-1 被顶成别的行。
   */
  it('迁移跑过两遍，种子没有被灌重', async () => {
    const follows = await pool.query<{ id: string }>(
      `SELECT id FROM follows WHERE id ~ '^f-[0-9]+$' ORDER BY id`,
    );
    expect(follows.rows.map((r) => r.id)).toEqual(['f-1', 'f-2', 'f-3']);

    const images = await pool.query<{ id: string }>(
      `SELECT id FROM post_images WHERE id ~ '^pi-[0-9]+$' ORDER BY id`,
    );
    expect(images.rows.map((r) => r.id)).toEqual([
      'pi-1',
      'pi-2',
      'pi-3',
      'pi-4',
      'pi-5',
      'pi-6',
    ]);
  });
});
