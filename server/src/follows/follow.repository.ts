import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/** DI token：关注仓储。无库时内存实现驱动演示（与 PET_REPOSITORY 同款）。 */
export const FOLLOW_REPOSITORY = 'FollowRepository';

export interface FollowPage {
  /** 宠物 id，按关注时间倒序。卡片投影交给 PetsService，仓储只管关系。 */
  petIds: string[];
  hasMore: boolean;
}

export interface FollowRepository {
  /** 幂等：重复关注不产生第二行，也不更新时间（关注时间应是首次关注的时间）。 */
  follow(userId: string, petId: string): Promise<void>;
  /** 幂等：取消未关注的不报错。 */
  unfollow(userId: string, petId: string): Promise<void>;
  listFollowing(userId: string, page: { page: number; pageSize: number }): Promise<FollowPage>;
  /** 批量：给定宠物 id 集合，返回其中已关注的那些及关注时间。列表页用它避免 N+1。 */
  followedAtByPetId(userId: string, petIds: string[]): Promise<Map<string, Date>>;
  /** 批量：只要「有没有关注」时用这个，省一次 Map 构造。 */
  followingPetIds(userId: string, petIds: string[]): Promise<Set<string>>;
}

@Injectable()
export class InMemoryFollowRepository implements FollowRepository {
  /** userId → (petId → 关注时间)。Map 保插入序，正好是关注的先后顺序。 */
  private readonly byUser = new Map<string, Map<string, Date>>();

  async follow(userId: string, petId: string): Promise<void> {
    const own = this.byUser.get(userId) ?? new Map<string, Date>();
    // 已存在就不动：关注时间要保持首次关注的时间，和 ON CONFLICT DO NOTHING 一致。
    if (!own.has(petId)) own.set(petId, new Date());
    this.byUser.set(userId, own);
  }

  async unfollow(userId: string, petId: string): Promise<void> {
    this.byUser.get(userId)?.delete(petId);
  }

  async listFollowing(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<FollowPage> {
    const all = [...(this.byUser.get(userId) ?? new Map<string, Date>()).keys()].reverse();
    const offset = (page - 1) * pageSize;
    const slice = all.slice(offset, offset + pageSize);
    return { petIds: slice, hasMore: offset + slice.length < all.length };
  }

  async followedAtByPetId(userId: string, petIds: string[]): Promise<Map<string, Date>> {
    const own = this.byUser.get(userId);
    const result = new Map<string, Date>();
    if (!own) return result;
    for (const petId of petIds) {
      const at = own.get(petId);
      if (at) result.set(petId, at);
    }
    return result;
  }

  async followingPetIds(userId: string, petIds: string[]): Promise<Set<string>> {
    return new Set((await this.followedAtByPetId(userId, petIds)).keys());
  }
}

/** PostgreSQL 实现（DATABASE_URL 存在时经 FollowsModule 工厂注入）。 */
@Injectable()
export class PostgresFollowRepository implements FollowRepository {
  constructor(private readonly pool: Pool) {}

  async follow(userId: string, petId: string): Promise<void> {
    // 撞唯一约束 (follower_id, target_pet_id) 就什么都不做 —— 幂等，且保留首次关注时间。
    // 外键故意不在这里 catch：关注不存在的宠物是调用方的错，应该冒出去。
    await this.pool.query(
      `INSERT INTO follows (id, follower_id, target_pet_id) VALUES ($1, $2, $3)
       ON CONFLICT (follower_id, target_pet_id) DO NOTHING`,
      [randomUUID(), userId, petId],
    );
  }

  async unfollow(userId: string, petId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM follows WHERE follower_id = $1 AND target_pet_id = $2`,
      [userId, petId],
    );
  }

  async listFollowing(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<FollowPage> {
    const offset = (page - 1) * pageSize;
    // 多取一条判断 hasMore，省一次 count 查询。
    const { rows } = await this.pool.query<{ target_pet_id: string }>(
      `SELECT target_pet_id FROM follows
       WHERE follower_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize + 1, offset],
    );
    const hasMore = rows.length > pageSize;
    return {
      petIds: rows.slice(0, pageSize).map((r) => r.target_pet_id),
      hasMore,
    };
  }

  async followedAtByPetId(userId: string, petIds: string[]): Promise<Map<string, Date>> {
    if (petIds.length === 0) return new Map();
    const { rows } = await this.pool.query<{ target_pet_id: string; created_at: Date }>(
      `SELECT target_pet_id, created_at FROM follows
       WHERE follower_id = $1 AND target_pet_id = ANY($2)`,
      [userId, petIds],
    );
    return new Map(rows.map((r) => [r.target_pet_id, r.created_at]));
  }

  async followingPetIds(userId: string, petIds: string[]): Promise<Set<string>> {
    return new Set((await this.followedAtByPetId(userId, petIds)).keys());
  }
}
