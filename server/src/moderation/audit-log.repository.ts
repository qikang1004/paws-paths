import { Injectable } from '@nestjs/common';
import type {
  AuditAction,
  AuditStatus,
  ModerationFilter,
  ModerationTargetType,
} from '@paws/types';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/**
 * 流水的筛选谓词（无库）与 SQL 片段（真库）。
 *
 * 流水能筛的两个维度是**动作**与**目标类型** —— 它没有 `reason`（举报原因在工单表上）
 * 也没有 `result`（流水记的是动作，不是结论）。传了那两个也不筛，因为 controller
 * 的 `allowed` 里压根没放它们。
 *
 * 两个实现必须语义一致：双跑契约测试（`audit-log-repository.spec.ts`）钉着这一点。
 */
function matchesLogFilter(
  row: Pick<AuditLogRow, 'action' | 'targetType'>,
  filter?: ModerationFilter,
): boolean {
  if (!filter) return true;
  if (filter.action && row.action !== filter.action) return false;
  if (filter.targetType && row.targetType !== filter.targetType) return false;
  return true;
}

/** 见 `matchesLogFilter`。`startAt` 之前的占位符留给 LIMIT / OFFSET。 */
function buildLogFilter(
  filter: ModerationFilter | undefined,
  startAt: number,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let n = startAt;
  // 值走占位符 —— 它们过了白名单，但拼进语句文本仍是一条不该开的路。
  if (filter?.action) {
    clauses.push(`l.action = $${n++}`);
    params.push(filter.action);
  }
  if (filter?.targetType) {
    clauses.push(`l.target_type = $${n++}`);
    params.push(filter.targetType);
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

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
 * 一页流水，连带操作人的显示名。
 *
 * `actorName` 是 JOIN 出来的，不是流水表里的列 —— 那张表刻意只存 `actor_id`
 * （改名不该改写一条不可变的记录）。`actorId` 有值而 `actorName` 为 null
 * 表示那个账号已经不在 `users` 里了：`actor_id` 不挂外键，所以这是正常状态。
 */
export interface AuditLogRowWithActor extends AuditLogRow {
  actorName: string | null;
}

/**
 * 审核动作的不可变流水（spec §4.4）。
 *
 * 接口上**只有读与追加**：Global Constraint 25 要求流水不可变，不给
 * update / delete 留方法就是最强的保证 —— 没有入口，就没有「顺手改一条」
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
  /**
   * 全局的一页流水，按时间倒序（最近的动作在最前）。
   *
   * 与 `listByTarget` 分开而不是给它加可选参数：那个方法是「这条内容的历史」，
   * 调用点在复核流程里、结果全量返回（一条内容的流水撑不到要分页）。这个是
   * 运营后台的合规视图，必须分页，而且要带操作人的显示名。混成一个方法会让
   * 前者也背上 JOIN 与分页参数。
   *
   * `hasMore` 靠多取一条判，省一次 count（同其他列表端点）。
   */
  list(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<{ items: AuditLogRowWithActor[]; hasMore: boolean }>;
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

  /**
   * 无库模式下 `actorName` 恒为 null —— 内存用户仓储按 openid 存，而这里只有
   * `actorId`，换一个显示名要把用户仓储注进来。不值那个耦合：无库是演示降级，
   * 合规视图在真库上看（同 `PostTargetSource.describe` 里昵称回退成 id 的理由）。
   */
  async list(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<{
    items: AuditLogRowWithActor[];
    hasMore: boolean;
  }> {
    // 追加序即时间序，倒序输出。不依赖 createdAt 的毫秒精度 —— 同一毫秒内
    // 追加的两条在真库上靠 id DESC 兜底，这里靠数组顺序。
    const all = [...this.rows].reverse().filter((row) => matchesLogFilter(row, opts.filter));
    const offset = (opts.page - 1) * opts.pageSize;
    const slice = all.slice(offset, offset + opts.pageSize);
    return {
      items: slice.map((r) => ({ ...r, actorName: null })),
      hasMore: offset + slice.length < all.length,
    };
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

  /**
   * 全局一页流水，倒序，连操作人显示名。
   *
   * `LEFT JOIN` 而不是 `JOIN`：机审的流水 `actor_id` 是 NULL，而账号注销后
   * 那个 id 也会指向不存在的行（`actor_id` 不挂外键 —— 流水必须比主体活得久）。
   * 内连接会让这两类流水**从合规视图里消失**，而它们恰恰是最需要留痕的那些。
   *
   * 显示名取 `username` 优先、`nickname` 兜底：运营账号的 nickname 就是用户名
   * （CLI 建号时那么写的），但微信用户没有 username —— 他们也会出现在这张表里
   * （举报动作的 actor 是举报人）。
   *
   * `ORDER BY created_at DESC, id DESC`：单条 CTE 里写两条流水时 `created_at`
   * 完全相同（`now()` 在一条语句里是常量），只按时间排会出不确定的顺序 ——
   * 那会让分页在页边界上漏行或重复。
   */
  async list(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<{
    items: AuditLogRowWithActor[];
    hasMore: boolean;
  }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const where = buildLogFilter(opts.filter, 3);
    const { rows } = await this.pool.query<{
      id: string;
      actor_id: string | null;
      actor_name: string | null;
      action: AuditAction;
      target_type: ModerationTargetType;
      target_id: string;
      status_before: AuditStatus;
      status_after: AuditStatus;
      created_at: Date;
    }>(
      // 筛选片段插在 JOIN 与 ORDER BY 之间。`$1` `$2` 是 LIMIT / OFFSET，
      // 筛选参数从 `$3` 起 —— PG 的占位符是位置绑定的。
      `SELECT l.id, l.actor_id,
              COALESCE(u.username, u.nickname) AS actor_name,
              l.action, l.target_type, l.target_id,
              l.status_before, l.status_after, l.created_at
         FROM audit_log l
         LEFT JOIN users u ON u.id = l.actor_id
        ${where.sql}
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT $1 OFFSET $2`,
      // 多取一条判 hasMore，省一次 count（同其他列表端点）。
      [opts.pageSize + 1, offset, ...where.params],
    );
    const items = rows.slice(0, opts.pageSize).map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      statusBefore: r.status_before,
      statusAfter: r.status_after,
      createdAt: r.created_at,
    }));
    return { items, hasMore: rows.length > opts.pageSize };
  }
}
