import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

/** DI token：收藏仓储。无库时内存实现驱动演示（与 PET_REPOSITORY 同款）。 */
export const FAVORITES_REPOSITORY = 'FavoritesRepository';

/**
 * spec §4.2 的多态收藏：宠物详情的收藏心标（原型 `_2`）与场所收藏（原型 `_3`）
 * 共用一张表，与 `favorites.target_type` 的 CHECK 约束一致。
 */
export type FavoriteTargetType = 'pet' | 'venue';

export interface FavoriteEntry {
  targetType: FavoriteTargetType;
  targetId: string;
  /** 保持 Date，ISO 化交给上层 —— 仓储不该关心下发格式。 */
  favoritedAt: Date;
}

export interface FavoritePage {
  entries: FavoriteEntry[];
  hasMore: boolean;
}

export interface FavoritesRepository {
  /**
   * 收藏。幂等，且**不刷新时间** —— 与 {@link ViewHistoryRepository.record} 的
   * DO UPDATE 刚好相反：再点一次已收藏的东西不该把它顶到收藏列表最前面。
   */
  add(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void>;
  /** 取消收藏。幂等：没收藏过也不报错。 */
  remove(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void>;
  /**
   * 批量查「这批 id 里哪些已收藏」，用于给列表/详情打心标。
   * 刻意不提供「取某人全部收藏 id」：给 10 张卡片打标不该把整个收藏夹拉进内存
   * （与 {@link FollowRepository.followingPetIds} 同款）。
   */
  favoriteIds(
    userId: string,
    targetType: FavoriteTargetType,
    targetIds: string[],
  ): Promise<Set<string>>;
  /** 「我的收藏」列表：按收藏时间倒序分页，pet/venue 混排。 */
  listByUser(userId: string, page: { page: number; pageSize: number }): Promise<FavoritePage>;
}

/** `(type, id)` 拼成内存 Map 的键：两类 id 空间独立，可能撞同一个字符串。 */
const key = (targetType: FavoriteTargetType, targetId: string): string =>
  `${targetType}:${targetId}`;

@Injectable()
export class InMemoryFavoritesRepository implements FavoritesRepository {
  /** userId → (「type:id」→ 收藏记录)。Map 保插入序，末尾即最近收藏。 */
  private readonly byUser = new Map<string, Map<string, FavoriteEntry>>();

  async add(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
    const own = this.byUser.get(userId) ?? new Map<string, FavoriteEntry>();
    const k = key(targetType, targetId);
    // 已收藏就原样不动（等价 ON CONFLICT DO NOTHING）：位置和时间都不能变。
    if (!own.has(k)) own.set(k, { targetType, targetId, favoritedAt: new Date() });
    this.byUser.set(userId, own);
  }

  async remove(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
    this.byUser.get(userId)?.delete(key(targetType, targetId));
  }

  async favoriteIds(
    userId: string,
    targetType: FavoriteTargetType,
    targetIds: string[],
  ): Promise<Set<string>> {
    const own = this.byUser.get(userId);
    if (!own || targetIds.length === 0) return new Set();
    return new Set(targetIds.filter((id) => own.has(key(targetType, id))));
  }

  async listByUser(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<FavoritePage> {
    const all = [...(this.byUser.get(userId) ?? new Map<string, FavoriteEntry>()).values()].reverse();
    const offset = (page - 1) * pageSize;
    const slice = all.slice(offset, offset + pageSize);
    return { entries: slice, hasMore: offset + slice.length < all.length };
  }
}

/** PostgreSQL 实现（DATABASE_URL 存在时经 FavoritesModule 工厂注入）。 */
@Injectable()
export class PostgresFavoritesRepository implements FavoritesRepository {
  constructor(private readonly pool: Pool) {}

  async add(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
    // DO NOTHING 而不是 DO UPDATE：重复收藏保留首次时间，列表不重排。
    // target_id 刻意没有外键：目标是多态的，且场所 id 来自腾讯 POI，本库可能没这行。
    await this.pool.query(
      `INSERT INTO favorites (user_id, target_type, target_id) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, target_type, target_id) DO NOTHING`,
      [userId, targetType, targetId],
    );
  }

  async remove(userId: string, targetType: FavoriteTargetType, targetId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM favorites WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [userId, targetType, targetId],
    );
  }

  async favoriteIds(
    userId: string,
    targetType: FavoriteTargetType,
    targetIds: string[],
  ): Promise<Set<string>> {
    // 空数组直接短路：= ANY('{}') 白跑一次往返。
    if (targetIds.length === 0) return new Set();
    const { rows } = await this.pool.query<{ target_id: string }>(
      `SELECT target_id FROM favorites
       WHERE user_id = $1 AND target_type = $2 AND target_id = ANY($3)`,
      [userId, targetType, targetIds],
    );
    return new Set(rows.map((r) => r.target_id));
  }

  async listByUser(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<FavoritePage> {
    const offset = (page - 1) * pageSize;
    // 多取一条判断 hasMore，省一次 count 查询。走 favorites_user_idx
    // (user_id, created_at DESC)；表没有行 id，用主键剩下两列兜同一微秒的并列。
    const { rows } = await this.pool.query<{
      target_type: FavoriteTargetType;
      target_id: string;
      created_at: Date;
    }>(
      `SELECT target_type, target_id, created_at FROM favorites
       WHERE user_id = $1
       ORDER BY created_at DESC, target_type DESC, target_id DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize + 1, offset],
    );
    return {
      entries: rows.slice(0, pageSize).map((r) => ({
        targetType: r.target_type,
        targetId: r.target_id,
        favoritedAt: r.created_at,
      })),
      hasMore: rows.length > pageSize,
    };
  }
}
