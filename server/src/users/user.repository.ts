import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { USER_ROLES, type UserRole } from '@paws/types';
import type { Pool } from 'pg';

export const USER_REPOSITORY = 'UserRepository';

/**
 * DI token：无库模式下的角色种子（`userId → role`）。
 *
 * 内存用户仓储没有 `users.role` 那一列可读，而运营端点的测试与无库演示都需要
 * 造一个 moderator 出来。做成可注入的令牌而不是写死常量：写死的话每加一个
 * 运营用例就要改仓储源码，而测试要造的身份本来就是用例自己的事。
 */
export const USER_ROLE_SEED = 'UserRoleSeed';

/**
 * DI token：无库模式下的运营凭据种子（`username → 凭据`）。
 *
 * 同 `USER_ROLE_SEED` 的理由 —— 内存用户仓储没有 `username` / `password_hash`
 * 两列可读，而运营登录的测试与无库演示都需要一个能登进去的账号。
 */
export const ADMIN_CREDENTIAL_SEED = 'AdminCredentialSeed';

/** 登录要用的那三样。`passwordHash` 是自描述串（见 `src/auth/password.ts`）。 */
export interface AdminCredential {
  userId: string;
  passwordHash: string;
  role: UserRole;
}

/** 无库模式的凭据种子：用户名 → 凭据。 */
export type AdminCredentialSeed = Record<string, AdminCredential>;

/**
 * 新用户的占位昵称。users.nickname 有 NOT NULL 约束，而微信登录只给 openid，
 * 昵称要用户自己在个人中心填。两个实现必须用同一个值：
 * 「占位昵称能改掉」是阶段 2 的验收项，两边发不同的占位值就测不准。
 */
export const PLACEHOLDER_NICKNAME = '微信用户';

export interface UserRecord {
  id: string;
  openid: string;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

/** 个人中心一次请求画完页面所需的全部字段，与 packages/types 的 ProfileDto 一致。 */
export interface UserProfile {
  nickname: string;
  avatarUrl: string | null;
  isVerifiedOwner: boolean;
  petCount: number;
  followingCount: number;
  favoriteCount: number;
}

/** PATCH /me 的可改字段。缺字段表示不动，`avatarUrl: null` 表示清空。 */
export interface UserProfilePatch {
  nickname?: string;
  avatarUrl?: string | null;
}

export interface UserRepository {
  findByOpenid(openid: string): Promise<UserRecord | null>;
  create(openid: string): Promise<UserRecord>;
  /** 资料与三个计数一起取回；用户不存在返回 null。 */
  findProfile(userId: string): Promise<UserProfile | null>;
  /** 更新后的资料，用户不存在返回 null。 */
  updateProfile(userId: string, patch: UserProfilePatch): Promise<UserProfile | null>;
  /**
   * 只取角色，用户不存在返回 `null`。
   *
   * 单独一个窄方法而不扩 `findProfile` 的返回形状：那个方法是个人中心的首屏查询，
   * 带三个计数子查询，而守卫每次请求只要一个 O(1) 的角色。三个既有调用方也不必跟着改。
   *
   * 角色**只从这里读**（Global Constraint 28）—— 不从 JWT 读，否则撤权要等令牌过期。
   */
  findRole(userId: string): Promise<UserRole | null>;
  /**
   * 按用户名取运营登录凭据，找不到返回 `null`。
   *
   * **只有运营账号有用户名** —— 小程序用户的 `username` / `password_hash` 都是
   * NULL（见 schema.sql 的迁移段）。所以这个方法对普通用户恒为 `null`，
   * 而调用方（`AuthService.loginWithPassword`）把「找不到」与「密码错」
   * 收敛成同一个 401，免得能问出「这个用户名存在」。
   */
  findCredentialByUsername(username: string): Promise<AdminCredential | null>;
}

/** 无库时的降级实现，驱动 InMemory 模式的演示。 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byOpenid = new Map<string, UserRecord>();

  /**
   * 角色种子。`@Optional()` 是为了不给既有的 `UsersModule` 加必填依赖 ——
   * 没注入时所有人都是 `user`，这正是无库演示该有的样子（谁也不是运营）。
   */
  constructor(
    @Optional() @Inject(USER_ROLE_SEED) private readonly roles: Record<string, UserRole> = {},
    @Optional()
    @Inject(ADMIN_CREDENTIAL_SEED)
    private readonly credentials: AdminCredentialSeed = {},
  ) {}

  async findByOpenid(openid: string): Promise<UserRecord | null> {
    return this.byOpenid.get(openid) ?? null;
  }

  /** 从注入的种子里读。没配就是「无库模式下谁也登不进后台」，那是对的默认。 */
  async findCredentialByUsername(username: string): Promise<AdminCredential | null> {
    return this.credentials[username] ?? null;
  }

  /**
   * 角色从注入的种子里读。种子里没有这个 id 就回 `null`（不是 `user`）——
   * 「查不到这个人」与「这个人是普通用户」在守卫那边虽然都是 403，
   * 但把两者混成同一个值会让将来「按角色分流」的代码拿不到真相。
   */
  async findRole(userId: string): Promise<UserRole | null> {
    const role = this.roles[userId];
    if (role) return role;
    // 种子里没有，但真的建过号的人算普通用户。
    return this.find(userId) ? 'user' : null;
  }

  async create(openid: string): Promise<UserRecord> {
    const record: UserRecord = {
      id: randomUUID(),
      openid,
      nickname: PLACEHOLDER_NICKNAME,
      avatarUrl: null,
      createdAt: new Date(),
    };
    this.byOpenid.set(openid, record);
    return record;
  }

  async findProfile(userId: string): Promise<UserProfile | null> {
    const record = this.find(userId);
    if (!record) return null;
    return {
      nickname: record.nickname ?? PLACEHOLDER_NICKNAME,
      avatarUrl: record.avatarUrl,
      // 以下三项无库模式下恒为 0：内存用户仓储看不见 pets/follows/favorites，
      // 要算真数就得把那三个仓储注进 UsersModule。无库是演示降级，不值这个耦合。
      isVerifiedOwner: false,
      petCount: 0,
      followingCount: 0,
      favoriteCount: 0,
    };
  }

  async updateProfile(userId: string, patch: UserProfilePatch): Promise<UserProfile | null> {
    const record = this.find(userId);
    if (!record) return null;
    if (patch.nickname !== undefined) record.nickname = patch.nickname;
    if (patch.avatarUrl !== undefined) record.avatarUrl = patch.avatarUrl;
    return this.findProfile(userId);
  }

  /** 建号发的是随机 id，按 id 找只能扫一遍；无库模式的用户数以演示为量级。 */
  private find(userId: string): UserRecord | undefined {
    for (const record of this.byOpenid.values()) {
      if (record.id === userId) return record;
    }
    return undefined;
  }
}

/**
 * PostgreSQL 实现。
 *
 * 用户必须真的落库：favorites.user_id 有外键指向 users，
 * 只存内存的话收藏接口会直接撞外键约束。
 */
@Injectable()
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findByOpenid(openid: string): Promise<UserRecord | null> {
    const { rows } = await this.pool.query(
      `SELECT id, openid, nickname, avatar_url, created_at FROM users WHERE openid = $1`,
      [openid],
    );
    return rows.length ? this.toRecord(rows[0]) : null;
  }

  async create(openid: string): Promise<UserRecord> {
    // nickname 有 NOT NULL 约束，新用户还没授权昵称，先占位。
    // ON CONFLICT 兜并发：两个请求同时为同一 openid 建号时，后到的取已有行。
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, openid, nickname) VALUES ($1, $2, $3)
       ON CONFLICT (openid) DO UPDATE SET openid = EXCLUDED.openid
       RETURNING id, openid, nickname, avatar_url, created_at`,
      [randomUUID(), openid, PLACEHOLDER_NICKNAME],
    );
    return this.toRecord(rows[0]);
  }

  /**
   * 三个计数走子查询而不是三次往返：个人中心是首屏，四次 RTT 全花在同一页上不划算。
   * count(*) 是 bigint，node-pg 会给成字符串，所以每个都 ::int。
   */
  async findProfile(userId: string): Promise<UserProfile | null> {
    const { rows } = await this.pool.query(
      `SELECT u.nickname, u.avatar_url, u.is_verified_owner,
              (SELECT count(*) FROM pets WHERE owner_id = u.id)::int AS pet_count,
              (SELECT count(*) FROM follows WHERE follower_id = u.id)::int AS following_count,
              (SELECT count(*) FROM favorites WHERE user_id = u.id)::int AS favorite_count
       FROM users u WHERE u.id = $1`,
      [userId],
    );
    return rows.length ? this.toProfile(rows[0]) : null;
  }

  async updateProfile(userId: string, patch: UserProfilePatch): Promise<UserProfile | null> {
    // 只拼调用方真给了的列：写死两列的话 avatarUrl 缺省会被当成「清空头像」。
    // 列名来自这里的定值，不来自请求体，没有注入面。
    const sets: string[] = [];
    const values: unknown[] = [userId];
    if (patch.nickname !== undefined) {
      values.push(patch.nickname);
      sets.push(`nickname = $${values.length}`);
    }
    if (patch.avatarUrl !== undefined) {
      values.push(patch.avatarUrl);
      sets.push(`avatar_url = $${values.length}`);
    }
    if (sets.length === 0) return this.findProfile(userId);

    const { rowCount } = await this.pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $1`,
      values,
    );
    // 计数不在 users 表里，UPDATE 的 RETURNING 给不全，回读一次拼完整资料。
    return rowCount ? this.findProfile(userId) : null;
  }

  /**
   * 只取一列。`role` 有 NOT NULL DEFAULT 'user'（见 schema.sql 的迁移段），
   * 所以查到行就一定有值；查不到行才是 `null`。
   *
   * 白名单再筛一次是为了「库里被手改成了乱值」那种情况 —— 生产上运营角色是
   * 人工 UPDATE 授的（见 RELEASE_CHECKLIST），列级 CHECK 兜得住，但真绕过了
   * 也不该让一个未知字符串在守卫里被当成有效角色。
   */
  async findRole(userId: string): Promise<UserRole | null> {
    const { rows } = await this.pool.query<{ role: string }>(
      `SELECT role FROM users WHERE id = $1`,
      [userId],
    );
    if (!rows[0]) return null;
    const role = rows[0].role;
    return (USER_ROLES as readonly string[]).includes(role) ? (role as UserRole) : null;
  }

  /**
   * 按用户名取凭据。
   *
   * `password_hash IS NOT NULL` 是必须的一半：一个只有用户名、没有密码的行
   * （手工建号时漏了第二步）绝不该能登录 —— 少了这个条件，`verifyPassword`
   * 会拿到 `null`，而那条路径上任何异常都收敛成 false，看起来像密码错，
   * 实际上是账号建坏了。显式在 SQL 里排掉，让两种情况在日志上分得开。
   *
   * 角色照旧过白名单筛（同 `findRole`）：库里被手改成乱值时不该当成有效角色。
   */
  async findCredentialByUsername(username: string): Promise<AdminCredential | null> {
    const { rows } = await this.pool.query<{
      id: string;
      password_hash: string;
      role: string;
    }>(
      `SELECT id, password_hash, role FROM users
        WHERE username = $1 AND password_hash IS NOT NULL`,
      [username],
    );
    if (!rows[0]) return null;
    const role = rows[0].role;
    if (!(USER_ROLES as readonly string[]).includes(role)) return null;
    return { userId: rows[0].id, passwordHash: rows[0].password_hash, role: role as UserRole };
  }

  private toProfile(row: Record<string, unknown>): UserProfile {
    return {
      nickname: (row.nickname as string | null) ?? PLACEHOLDER_NICKNAME,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      isVerifiedOwner: row.is_verified_owner === true,
      petCount: Number(row.pet_count),
      followingCount: Number(row.following_count),
      favoriteCount: Number(row.favorite_count),
    };
  }

  private toRecord(row: Record<string, unknown>): UserRecord {
    return {
      id: String(row.id),
      openid: String(row.openid),
      nickname: (row.nickname as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
      createdAt: row.created_at as Date,
    };
  }
}
