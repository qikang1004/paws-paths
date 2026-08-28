import { Injectable } from '@nestjs/common';
import type { AuditAction, AuditStatus, ModerationTargetType } from '@paws/types';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** DI token：审计流水仓储。无库时内存实现驱动演示（与 FOLLOW_REPOSITORY 同款）。 */
export const AUDIT_LOG_REPOSITORY = 'AuditLogRepository';

/**
 * 一条待写入的流水。`id` 与 `createdAt` 由仓储生成 —— 调用方不该有机会
 * 伪造一条「发生在过去」的审核记录。
 */
export interface AuditLogEntry {
  /** 机审没有操作人，为 null。人工动作一律带值。 */
  actorId: string | null;
  action: AuditAction;
  targetType: ModerationTargetType;
  targetId: string;
  statusBefore: AuditStatus;
  statusAfter: AuditStatus;
}

/** 已落库的流水。 */
export interface AuditLogRow extends AuditLogEntry {
  id: string;
  createdAt: Date;
}

/**
 * 审核动作的不可变流水（spec §4.4）。
 *
 * 接口上**只有** `append` 与 `listByTarget`：Global Constraint 25 要求流水不可变，
 * 不给 update / delete 留方法就是最强的保证 —— 没有入口，就没有「顺手改一条」
 * 的可能。契约测试里有一条专门钉住这个接口面。
 *
 * `client` 是可选的外部连接：Global Constraint 24 要求「改状态」与「写流水」原子，
 * 调用方把自己事务的 client 传进来，两件事就在同一个事务里。不传就走 pool。
 */
export interface AuditLogRepository {
  append(entry: AuditLogEntry, client?: PoolClient): Promise<void>;
  listByTarget(
    targetType: ModerationTargetType,
    targetId: string,
    client?: PoolClient,
  ): Promise<AuditLogRow[]>;
}

@Injectable()
export class InMemoryAuditLogRepository implements AuditLogRepository {
  /** 追加序即时间序。倒序输出时反转，不依赖 createdAt 的毫秒精度。 */
  private readonly rows: AuditLogRow[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.rows.push({ ...entry, id: randomUUID(), createdAt: new Date() });
  }

  async listByTarget(
    targetType: ModerationTargetType,
    targetId: string,
  ): Promise<AuditLogRow[]> {
    // target_id 是多态的：光比 id 会让 post 与 post_image 的流水串在一起。
    return this.rows
      .filter((r) => r.targetType === targetType && r.targetId === targetId)
      .reverse();
  }
}

/** PostgreSQL 实现（DATABASE_URL 存在时经 ModerationModule 工厂注入）。 */
@Injectable()
export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async append(entry: AuditLogEntry, client?: PoolClient): Promise<void> {
    await (client ?? this.pool).query(
      `INSERT INTO audit_log
         (id, actor_id, action, target_type, target_id, status_before, status_after)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        randomUUID(),
        entry.actorId,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.statusBefore,
        entry.statusAfter,
      ],
    );
  }

  async listByTarget(
    targetType: ModerationTargetType,
    targetId: string,
    client?: PoolClient,
  ): Promise<AuditLogRow[]> {
    const { rows } = await (client ?? this.pool).query<{
      id: string;
      actor_id: string | null;
      action: AuditAction;
      target_type: ModerationTargetType;
      target_id: string;
      status_before: AuditStatus;
      status_after: AuditStatus;
      created_at: Date;
    }>(
      // id DESC 是同毫秒写入时的稳定兜底 —— 单条 CTE 里写两条流水时 created_at
      // 会完全相同（now() 在一条语句里是常量），只按时间排会出不确定的顺序。
      `SELECT id, actor_id, action, target_type, target_id, status_before, status_after, created_at
         FROM audit_log
        WHERE target_type = $1 AND target_id = $2
        ORDER BY created_at DESC, id DESC`,
      [targetType, targetId],
    );
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      statusBefore: r.status_before,
      statusAfter: r.status_after,
      createdAt: r.created_at,
    }));
  }
}
