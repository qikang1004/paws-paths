import { randomUUID } from 'node:crypto';
import type { UserRole } from '@paws/types';

/**
 * 建号/改号的那条 upsert，从 CLI 里提出来。
 *
 * 提出来的理由是**可测**：这条 SQL 原先内联在 `scripts/create-admin.ts` 的
 * `main()` 里，而那个文件从 argv 取参、从 stdin 读密码、跑完 `process.exit` ——
 * 没有任何测试碰得到它。而它是整条运营登录链上唯一会**写**库的语句，
 * 写错的后果是「建出一个登不进去的账号」或「悄悄改掉了别人的密码」。
 *
 * 只接受一个能 `query` 的东西（`Pool` 与 `PoolClient` 都满足），所以集成测试
 * 可以在事务里跑它再回滚 —— 那个库是共享的，留下的行会让别的套件数不清。
 */
export interface Queryable {
  query<R extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface UpsertAdminInput {
  username: string;
  /** 自描述哈希串（见 `password.ts`）。这里不做哈希 —— 调用方负责。 */
  passwordHash: string;
  role: UserRole;
}

export interface UpsertAdminResult {
  userId: string;
  /** true = 新建，false = 更新了既有账号的密码与角色。 */
  created: boolean;
}

/**
 * 运营账号的合成 openid 前缀。
 *
 * `users.openid` 有 `NOT NULL UNIQUE`，而纯运营账号压根没有微信身份。真 openid
 * 是 28 位左右的 base64-ish 串、**不含冒号**，所以这个前缀不可能与之相撞。
 *
 * 具名导出是为了让测试能断言「这确实是个合成身份」，而不是在测试里再抄一遍前缀。
 */
export const ADMIN_OPENID_PREFIX = 'admin:';

export function adminOpenid(username: string): string {
  return `${ADMIN_OPENID_PREFIX}${username}`;
}

/**
 * 建一个运营账号，或更新既有同名账号的密码与角色。
 *
 * **用户名已存在时改密码而不是报错** —— 这个函数同时是「重置密码」与「改角色」
 * 工具（降权也走这条路）。CLI 是唯一的加人入口，再要一条专门的重置路径只会
 * 多一处会分叉的 SQL。
 *
 * 单条语句里用 CTE 而不是「先 SELECT 再决定 INSERT/UPDATE」：后者在两个人同时
 * 建同一个用户名时会双双走到 INSERT，其中一个撞唯一索引崩掉。这里 `created` 那支
 * 带 `WHERE NOT EXISTS (SELECT 1 FROM existing)`，同一条语句里判，不留窗口。
 *
 * `id` 与 openid 由本函数生成 —— 调用方不该有机会指定运营账号的主键。
 */
export async function upsertAdminAccount(
  db: Queryable,
  input: UpsertAdminInput,
): Promise<UpsertAdminResult | null> {
  const { rows } = await db.query<{ id: string; created: boolean }>(
    `WITH existing AS (
       UPDATE users SET password_hash = $2, role = $3
        WHERE username = $1
       RETURNING id
     ), created AS (
       INSERT INTO users (id, openid, nickname, role, username, password_hash)
       SELECT $4, $5, $1, $3, $1, $2
        WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id
     )
     SELECT id, false AS created FROM existing
     UNION ALL
     SELECT id, true AS created FROM created`,
    [input.username, input.passwordHash, input.role, randomUUID(), adminOpenid(input.username)],
  );

  const row = rows[0];
  // 既没更新也没插入：库里没有 username 那一列（没跑迁移）。返回 null 让调用方
  // 给出可操作的报错，而不是在这里抛一个 pg 的原始异常。
  if (!row) return null;
  return { userId: row.id, created: row.created };
}
