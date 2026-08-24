import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const USER_REPOSITORY = 'UserRepository';

export interface UserRecord {
  id: string;
  openid: string;
  nickname: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

export interface UserRepository {
  findByOpenid(openid: string): Promise<UserRecord | null>;
  create(openid: string): Promise<UserRecord>;
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
      nickname: null,
      avatarUrl: null,
      createdAt: new Date(),
    };
    this.byOpenid.set(openid, record);
    return record;
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
      [randomUUID(), openid, '微信用户'],
    );
    return this.toRecord(rows[0]);
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
