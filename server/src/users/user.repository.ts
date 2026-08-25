import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const USER_REPOSITORY = 'UserRepository';

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
}

/** 无库时的降级实现，驱动 InMemory 模式的演示。 */
@Injectable()
export class InMemoryUserRepository implements UserRepository {
  private readonly byOpenid = new Map<string, UserRecord>();

  async findByOpenid(openid: string): Promise<UserRecord | null> {
    return this.byOpenid.get(openid) ?? null;
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
