import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/** DI token：浏览历史仓储。无库时内存实现驱动演示（与 PET_REPOSITORY 同款）。 */
export const VIEW_HISTORY_REPOSITORY = 'ViewHistoryRepository';

/** 本阶段只记宠物与场所两类，与 view_history.target_type 的 CHECK 约束一致。 */
export type ViewTargetType = 'pet' | 'venue';

export interface ViewHistoryEntry {
  targetType: ViewTargetType;
  targetId: string;
  /** 保持 Date，ISO 化交给上层 —— 仓储不该关心下发格式。 */
  viewedAt: Date;
}

export interface ViewHistoryPage {
  entries: ViewHistoryEntry[];
  hasMore: boolean;
}

export interface ViewHistoryRepository {
  /**
   * 记一次浏览。幂等：同一 `(user, targetType, targetId)` 只留一行，重复浏览
   * 刷新 `viewed_at`（spec §4.2「按 (user, target) 幂等更新时间戳」）。
   */
  record(userId: string, targetType: ViewTargetType, targetId: string): Promise<void>;
  /** 按 `viewed_at` 倒序分页。目标是否还存在由上层投影时判断，仓储只管关系。 */
  list(userId: string, page: { page: number; pageSize: number }): Promise<ViewHistoryPage>;
}

/** `(type, id)` 拼成内存 Map 的键：两类 id 空间独立，可能撞同一个字符串。 */
const key = (targetType: ViewTargetType, targetId: string): string => `${targetType}:${targetId}`;

@Injectable()
export class InMemoryViewHistoryRepository implements ViewHistoryRepository {
  /** userId → (「type:id」→ 浏览时间)。Map 保插入序，末尾即最近。 */
  private readonly byUser = new Map<string, Map<string, ViewHistoryEntry>>();

  async record(userId: string, targetType: ViewTargetType, targetId: string): Promise<void> {
    const own = this.byUser.get(userId) ?? new Map<string, ViewHistoryEntry>();
    const k = key(targetType, targetId);
    // 先删再插：Map 的插入序就是时间序，重插才能把它挪到末尾 ——
    // 等价于 ON CONFLICT DO UPDATE SET viewed_at = now()（行数不变，时间刷新）。
    own.delete(k);
    own.set(k, { targetType, targetId, viewedAt: new Date() });
    this.byUser.set(userId, own);
  }

  async list(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<ViewHistoryPage> {
    const all = [...(this.byUser.get(userId) ?? new Map()).values()].reverse();
    const offset = (page - 1) * pageSize;
    const slice = all.slice(offset, offset + pageSize);
    return { entries: slice, hasMore: offset + slice.length < all.length };
  }
}

/** PostgreSQL 实现（DATABASE_URL 存在时经 HistoryModule 工厂注入）。 */
@Injectable()
export class PostgresViewHistoryRepository implements ViewHistoryRepository {
  constructor(private readonly pool: Pool) {}

  async record(userId: string, targetType: ViewTargetType, targetId: string): Promise<void> {
    // 撞唯一约束 (user_id, target_type, target_id) 就只刷时间，不新增行（Global Constraint 19）。
    // target_id 刻意没有外键：目标是多态的（pet/venue 两张表），且场所 id 来自
    // 腾讯 POI，本库可能根本没这行。目标失效由投影时跳过处理。
    await this.pool.query(
      `INSERT INTO view_history (id, user_id, target_type, target_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, target_type, target_id) DO UPDATE SET viewed_at = now()`,
      [randomUUID(), userId, targetType, targetId],
    );
  }

  async list(
    userId: string,
    { page, pageSize }: { page: number; pageSize: number },
  ): Promise<ViewHistoryPage> {
    const offset = (page - 1) * pageSize;
    // 多取一条判断 hasMore，省一次 count 查询。
    // 走 view_history_user_idx (user_id, viewed_at DESC)；id 兜同一微秒的并列。
    const { rows } = await this.pool.query<{
      target_type: ViewTargetType;
      target_id: string;
      viewed_at: Date;
    }>(
      `SELECT target_type, target_id, viewed_at FROM view_history
       WHERE user_id = $1
       ORDER BY viewed_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [userId, pageSize + 1, offset],
    );
    return {
      entries: rows.slice(0, pageSize).map((r) => ({
        targetType: r.target_type,
        targetId: r.target_id,
        viewedAt: r.viewed_at,
      })),
      hasMore: rows.length > pageSize,
    };
  }
}
