import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

/** DI token：收藏仓储。无库时内存实现驱动演示。 */
export const FAVORITES_REPOSITORY = 'FavoritesRepository';

export interface FavoritesRepository {
  list(userId: string): Promise<string[]>;
  add(userId: string, poiId: string): Promise<void>;
  remove(userId: string, poiId: string): Promise<void>;
}

/** 内存实现：add/remove 幂等（Set 语义）。 */
@Injectable()
export class InMemoryFavoritesRepository implements FavoritesRepository {
  private readonly byUser = new Map<string, Set<string>>();

  async list(userId: string): Promise<string[]> {
    return [...(this.byUser.get(userId) ?? [])];
  }

  async add(userId: string, poiId: string): Promise<void> {
    const set = this.byUser.get(userId) ?? new Set<string>();
    set.add(poiId);
    this.byUser.set(userId, set);
  }

  async remove(userId: string, poiId: string): Promise<void> {
    this.byUser.get(userId)?.delete(poiId);
  }
}

/** PostgreSQL 实现：ON CONFLICT DO NOTHING 保证 add 幂等。 */
export class PostgresFavoritesRepository implements FavoritesRepository {
  constructor(private readonly pool: Pool) {}

  async list(userId: string): Promise<string[]> {
    const res = await this.pool.query<{ poi_id: string }>(
      `SELECT poi_id FROM favorites WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows.map((r) => r.poi_id);
  }

  async add(userId: string, poiId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO favorites (user_id, poi_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, poiId],
    );
  }

  async remove(userId: string, poiId: string): Promise<void> {
    await this.pool.query(`DELETE FROM favorites WHERE user_id = $1 AND poi_id = $2`, [
      userId,
      poiId,
    ]);
  }
}
