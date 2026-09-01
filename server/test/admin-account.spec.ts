import { adminOpenid, ADMIN_OPENID_PREFIX, upsertAdminAccount, type Queryable } from '../src/auth/admin-account';

/**
 * 那条 upsert 的无库部分：参数绑定与返回值映射。
 *
 * 真库行为（并发建号、部分唯一索引、既有账号被改密码）在
 * `admin-account.integration.spec.ts` 里 —— 这套只证「发出去的 SQL 与参数是对的」。
 */
class FakeDb implements Queryable {
  readonly calls: { sql: string; params: unknown[] }[] = [];

  constructor(private readonly rows: Record<string, unknown>[]) {}

  async query<R extends Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: R[] }> {
    this.calls.push({ sql, params });
    return { rows: this.rows as R[] };
  }
}

const INPUT = { username: 'ops-alice', passwordHash: 'scrypt$16384$8$1$c2FsdA$aGFzaA', role: 'moderator' as const };

describe('upsertAdminAccount（无库）', () => {
  it('新建时返回 created=true 与库里生成的 id', async () => {
    const db = new FakeDb([{ id: 'u-new', created: true }]);
    expect(await upsertAdminAccount(db, INPUT)).toEqual({ userId: 'u-new', created: true });
  });

  it('更新既有账号时返回 created=false', async () => {
    const db = new FakeDb([{ id: 'u-old', created: false }]);
    expect(await upsertAdminAccount(db, INPUT)).toEqual({ userId: 'u-old', created: false });
  });

  /**
   * 一行都没有意味着库里没有 `username` 那一列（没跑迁移）。返回 null 而不是抛 ——
   * 调用方要给一句能照着做的话，而不是把 pg 的原始异常打给运维。
   */
  it('既没更新也没插入时返回 null', async () => {
    expect(await upsertAdminAccount(new FakeDb([]), INPUT)).toBeNull();
  });

  it('用户名、哈希、角色按位置绑定，不拼进 SQL 文本', async () => {
    const db = new FakeDb([{ id: 'u-1', created: true }]);
    await upsertAdminAccount(db, INPUT);
    const { sql, params } = db.calls[0];
    expect(params[0]).toBe(INPUT.username);
    expect(params[1]).toBe(INPUT.passwordHash);
    expect(params[2]).toBe(INPUT.role);
    // 用户名与哈希绝不该出现在语句文本里 —— 那是注入面，也会进慢查询日志。
    expect(sql).not.toContain(INPUT.username);
    expect(sql).not.toContain(INPUT.passwordHash);
  });

  /** id 由本函数生成，调用方不该有机会指定运营账号的主键。 */
  it('每次生成一个新的 uuid 作为 id', async () => {
    const db = new FakeDb([{ id: 'u-1', created: true }]);
    await upsertAdminAccount(db, INPUT);
    await upsertAdminAccount(db, INPUT);
    const [first, second] = db.calls.map((c) => c.params[3]);
    expect(first).not.toBe(second);
    expect(String(first)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('openid 是带前缀的合成身份', async () => {
    const db = new FakeDb([{ id: 'u-1', created: true }]);
    await upsertAdminAccount(db, INPUT);
    expect(db.calls[0].params[4]).toBe(`${ADMIN_OPENID_PREFIX}${INPUT.username}`);
  });

  /**
   * 真 openid 是 28 位左右的 base64-ish 串，**不含冒号** —— 前缀里的冒号就是
   * 「这不可能是真微信身份」的保证。断言它在，是为了别有人把前缀改成 `admin-`。
   */
  it('合成 openid 含冒号，与真微信 openid 的字符集不相交', () => {
    expect(adminOpenid('x')).toContain(':');
  });

  it('单条语句完成，不是先查再写（并发建同名号不会双双 INSERT）', async () => {
    const db = new FakeDb([{ id: 'u-1', created: true }]);
    await upsertAdminAccount(db, INPUT);
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toMatch(/WHERE NOT EXISTS \(SELECT 1 FROM existing\)/);
  });
});
