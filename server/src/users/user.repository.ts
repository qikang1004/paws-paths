import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

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

/** 阶段 0 占位实现；阶段 1 换成 PostgreSQL 实现，接口不动。 */
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
