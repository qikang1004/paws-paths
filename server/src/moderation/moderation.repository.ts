import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditStatus, ModerationSource, ModerationTargetType, ReportReason } from '@paws/types';
import type { Pool } from 'pg';
import type { AuditLogEntry } from './audit-log.repository';

/** DI token：审核工单仓储（队列）。无库时内存实现驱动演示（与 AUDIT_LOG_REPOSITORY 同款）。 */
export const MODERATION_REPOSITORY = 'ModerationRepository';

/** 举报/复核指向的那一条内容。多态：`post` 与 `post_image` 是两张表。 */
export interface ModerationTargetRef {
  targetType: ModerationTargetType;
  targetId: string;
}

/**
 * 目标的可见性判定所需的最小信息。
 *
 * 只有状态与作者两样：可见性判定就是 `isVisibleTo(status, authorId === viewerId)`。
 * 不复用 `PostRow` —— `post_image` 没有 `content` / `publishedAt` 那些字段，
 * 而这条路径上要的正好是两张表都有的那两样。
 */
export interface ModerationTarget extends ModerationTargetRef {
  status: AuditStatus;
  /** 内容的作者。图片取所属动态的作者 —— 图片自己没有 `author_id`。 */
  authorId: string;
}

/** 已落库的工单。`result` 为 `null` 即待处理。 */
export interface ModerationTaskRow extends ModerationTargetRef {
  id: string;
  source: ModerationSource;
  reportedBy: string | null;
  reason: ReportReason | null;
  result: 'approved' | 'rejected' | null;
  handledBy: string | null;
  handledAt: Date | null;
  createdAt: Date;
}

/** 举报一次要落的三件事的入参。 */
export interface ReportInput {
  target: ModerationTarget;
  /** 举报人。举报一律有人，机审那条路径不入队。 */
  reporterId: string;
  reason: ReportReason;
  /** 举报后要迁到的状态。由上层的 `assertTransition` 把过关。 */
  statusAfter: AuditStatus;
  /** 与状态迁移同一条语句写下的流水。 */
  entry: AuditLogEntry;
}

/**
 * 队列里的一条工单，连带被举报内容的原文。
 *
 * `content` / `imageUrls` / `authorNickname` 是**给运营看的**：他要看内容才能判。
 * `isVisibleTo` 在这条路径上刻意不适用（运营不是作者，但必须看得见
 * `pending_review` 的内容）—— 这是有意的例外，也是这个类型不能与 `PostRow` 合并的原因。
 */
export interface ModerationTaskWithContent extends ModerationTaskRow {
  content: string;
  imageUrls: string[];
  authorNickname: string;
}

/**
 * 一条已处理的工单，连带内容与复核人显示名。
 *
 * `result` / `handledAt` 在这个类型上**不可空** —— 查询的 WHERE 就是
 * `result IS NOT NULL`，所以那两个字段一定有值。收窄在类型上，DTO 那层就不必判空。
 *
 * `handledByName` 是 JOIN 出来的。`handled_by` 挂 `ON DELETE SET NULL`，
 * 所以它为 null 有两种可能：账号注销后指针被置空，或者显示名取不到。
 * 两者对运营是同一件事（「不知道是谁」），不必分开。
 */
export interface HandledTaskRow extends Omit<ModerationTaskWithContent, 'result' | 'handledAt'> {
  result: 'approved' | 'rejected';
  handledAt: Date;
  handledByName: string | null;
}

/**
 * 复核一次要落的三件事的入参。
 *
 * 带上 `target` 而不是让仓储自己再查一次：上层为了 `assertTransition` 本来就得
 * 先取到目标的当前状态（状态机唯一实现点在服务层），把它传下来省一次往返，
 * 也让「流水里的 statusBefore」与「状态机判过的那个值」一定是同一个。
 */
export interface ResolveInput {
  taskId: string;
  target: ModerationTarget;
  /** 复核人。运营侧动作一律有操作人。 */
  moderatorId: string;
  result: 'approved' | 'rejected';
  /** 复核后目标要迁到的状态。由上层的 `assertTransition` 把过关。 */
  statusAfter: AuditStatus;
  /** 驳回原因。`approved` 时为 null —— 放行没有原因可写。 */
  rejectReason: string | null;
  /** 与拿票、状态迁移同一条语句写下的流水。 */
  entry: AuditLogEntry;
}

/**
 * 审核工单队列（spec §4.4）。
 *
 * 与 `AuditLogRepository` 分开是 Global Constraint 25 的要求：那张是不可变流水，
 * 这张是可被更新的队列，不可互相替代。所以这个接口有 `resolve`（会 UPDATE），
 * 而流水那个接口连 update 方法都没有。
 */
export interface ModerationRepository {
  /**
   * 取一条目标的状态与作者，供可见性判定用。不做可见性过滤 ——
   * 判定要 `authorId`，交给上层的 `isVisibleTo`（举报要区分 404 与 200）。
   */
  findTarget(ref: ModerationTargetRef): Promise<ModerationTarget | null>;

  /**
   * 举报：**状态迁移 + 写流水 + 入队三件事原子完成**（Global Constraint 24）。
   *
   * 返回新建的工单；已经有未处理工单时返回 `null` —— 那是幂等分支，
   * 调用方据此判断「这次没产生新工单」，既不重复写流水也不报错
   * （Global Constraint 27）。
   */
  report(input: ReportInput): Promise<ModerationTaskRow | null>;

  /** 某个目标当前未处理的工单。测试与幂等判定都用它。 */
  listOpenTasksByTarget(ref: ModerationTargetRef): Promise<ModerationTaskRow[]>;

  /**
   * 待处理工单的一页，**按创建时间正序**（先举报的先处理），连带内容原文。
   *
   * 多取一条判 `hasMore`，与其他列表同款（省一次 count）。
   */
  listOpenTasks(opts: {
    page: number;
    pageSize: number;
  }): Promise<{ items: ModerationTaskWithContent[]; hasMore: boolean }>;

  /**
   * **已处理**工单的一页，按处理时间倒序（最近判的在最前）。
   *
   * 与 `listOpenTasks` 分成两个方法而不是加一个 `handled` 开关：两者的排序相反
   * （待办按举报时间正序 —— 先举报的先处理；历史按处理时间倒序 —— 最近判的先看到），
   * 而且这一条要多 JOIN 一次 users 取复核人显示名。一个方法里塞两种排序，
   * 迟早有人改一处忘了另一处。
   */
  listHandledTasks(opts: {
    page: number;
    pageSize: number;
  }): Promise<{ items: HandledTaskRow[]; hasMore: boolean }>;

  /** 按 id 取一条工单（不论是否已处理）。用于把「不存在」与「已处理」分开。 */
  findTaskById(taskId: string): Promise<ModerationTaskRow | null>;

  /**
   * 复核：**拿票 + 状态迁移 + 写流水三件事原子完成**（Global Constraint 24）。
   *
   * 「拿票」是带条件的 UPDATE（`WHERE id = $x AND result IS NULL`）——
   * 受影响行数为 0 就是别人先处理了，返回 `null`。**不做**「先 SELECT 判断再
   * UPDATE」：那两步之间有窗口，两个运营同时点会双双通过。
   */
  resolve(input: ResolveInput): Promise<ModerationTaskRow | null>;
}

/**
 * 无库模式的实现。
 *
 * 目标的状态**不存在这里** —— 动态在 `InMemoryPostRepository` 里。两个内存仓储
 * 各存一半会立刻分叉（举报改了这边的状态，列表读的是那边的），所以这个实现
 * 把「找目标」和「改状态」两件事委托给注入进来的动态仓储。
 */
@Injectable()
export class InMemoryModerationRepository implements ModerationRepository {
  private readonly tasks: ModerationTaskRow[] = [];

  constructor(
    private readonly targets: InMemoryModerationTargetSource,
    private readonly auditLog: { append(entry: AuditLogEntry): Promise<void> },
  ) {}

  async findTarget(ref: ModerationTargetRef): Promise<ModerationTarget | null> {
    return this.targets.findTarget(ref);
  }

  /** 顺序做三步。内存里没有事务可开，但也没有中途崩掉的往返。 */
  async report(input: ReportInput): Promise<ModerationTaskRow | null> {
    const open = await this.listOpenTasksByTarget(input.target);
    if (open.length > 0) return null;

    await this.targets.setStatus(input.target, input.statusAfter, null);
    await this.auditLog.append(input.entry);
    const task: ModerationTaskRow = {
      id: randomUUID(),
      targetType: input.target.targetType,
      targetId: input.target.targetId,
      source: 'user_report',
      reportedBy: input.reporterId,
      reason: input.reason,
      result: null,
      handledBy: null,
      handledAt: null,
      createdAt: new Date(),
    };
    this.tasks.push(task);
    return { ...task };
  }

  async listOpenTasksByTarget(ref: ModerationTargetRef): Promise<ModerationTaskRow[]> {
    return this.tasks
      .filter(
        (task) =>
          task.targetType === ref.targetType &&
          task.targetId === ref.targetId &&
          task.result === null,
      )
      .map((task) => ({ ...task }));
  }

  /** 追加序即创建时间序 —— 不依赖 `createdAt` 的毫秒精度（同流水仓储的理由）。 */
  async listOpenTasks(opts: { page: number; pageSize: number }): Promise<{
    items: ModerationTaskWithContent[];
    hasMore: boolean;
  }> {
    const open = this.tasks.filter((task) => task.result === null);
    const offset = (opts.page - 1) * opts.pageSize;
    const slice = open.slice(offset, offset + opts.pageSize);
    const items: ModerationTaskWithContent[] = [];
    for (const task of slice) {
      const described = await this.targets.describe(task);
      // 内容取不到的工单直接跳过（目标被删了）—— 空壳工单在运营界面上没法处理。
      if (described) items.push({ ...task, ...described });
    }
    return { items, hasMore: offset + slice.length < open.length };
  }

  /**
   * 已处理的一页，按 `handledAt` 倒序。
   *
   * `handledByName` 恒为 null —— 内存用户仓储按 openid 存，这里只有 id
   * （同 `InMemoryAuditLogRepository.list` 与 `PostTargetSource.describe` 的理由）。
   */
  async listHandledTasks(opts: { page: number; pageSize: number }): Promise<{
    items: HandledTaskRow[];
    hasMore: boolean;
  }> {
    const handled = this.tasks
      .filter((task): task is ModerationTaskRow & { result: 'approved' | 'rejected'; handledAt: Date } =>
        task.result !== null && task.handledAt !== null,
      )
      // 倒序：最近判的在最前。同一毫秒的两条靠追加序兜底（reverse 前先按时间排）。
      .sort((a, b) => b.handledAt.getTime() - a.handledAt.getTime());
    const offset = (opts.page - 1) * opts.pageSize;
    const slice = handled.slice(offset, offset + opts.pageSize);
    const items: HandledTaskRow[] = [];
    for (const task of slice) {
      const described = await this.targets.describe(task);
      // 目标被删了：内容给空，**工单仍要出现** —— 这与待办列表相反。
      // 那边跳过空壳是因为没法处理，而这边是历史：判过什么必须查得到。
      items.push({
        ...task,
        content: described?.content ?? '',
        imageUrls: described?.imageUrls ?? [],
        authorNickname: described?.authorNickname ?? '',
        handledByName: null,
      });
    }
    return { items, hasMore: offset + slice.length < handled.length };
  }

  async findTaskById(taskId: string): Promise<ModerationTaskRow | null> {
    const task = this.tasks.find((candidate) => candidate.id === taskId);
    return task ? { ...task } : null;
  }

  /**
   * 顺序做三步，但**拿票那一步先做且只做一次**。
   *
   * 内存里没有真并发，可是 `Promise.all` 两次复核仍会交错在 await 上 ——
   * 先把 `result` 写下去（同步、无 await 间隙），后到的那次就看到已处理了。
   */
  async resolve(input: ResolveInput): Promise<ModerationTaskRow | null> {
    const task = this.tasks.find((candidate) => candidate.id === input.taskId);
    if (!task || task.result !== null) return null;
    // 拿票：这一步与上面的判断之间没有 await，等价于带条件的 UPDATE。
    task.result = input.result;
    task.handledBy = input.moderatorId;
    task.handledAt = new Date();

    await this.targets.setStatus(task, input.statusAfter, input.rejectReason);
    await this.auditLog.append(input.entry);
    return { ...task };
  }
}

/**
 * 内存模式下「目标在哪」的适配面。
 *
 * 由 `ModerationModule` 用动态仓储实现 —— 这个接口的存在是为了让审核域不必
 * import 整个动态域的仓储类型（举报将来还要覆盖别的目标类型）。
 */
export interface InMemoryModerationTargetSource {
  findTarget(ref: ModerationTargetRef): Promise<ModerationTarget | null>;
  setStatus(ref: ModerationTargetRef, status: AuditStatus, rejectReason: string | null): Promise<void>;
  /** 工单列表要的内容原文。运营要看内容才能判 —— 见 `ModerationTaskWithContent`。 */
  describe(ref: ModerationTargetRef): Promise<{
    content: string;
    imageUrls: string[];
    authorNickname: string;
  } | null>;
}

/**
 * 目标类型 → 取状态与作者的 SQL。
 *
 * 表名与列名来自这张**定值表**，不来自请求（`target_type` 先过白名单校验才走到这里），
 * 所以拼进语句里没有注入面。图片的作者取所属动态的 —— `post_images` 自己没有作者列。
 */
const TARGET_SELECT: Readonly<Record<ModerationTargetType, string>> = {
  post: `SELECT audit_status AS status, author_id FROM posts WHERE id = $1`,
  post_image: `SELECT pi.audit_status AS status, po.author_id
                 FROM post_images pi JOIN posts po ON po.id = pi.post_id
                WHERE pi.id = $1`,
};

/**
 * 目标类型 → 存放它的表名。同上，是定值表，不来自请求。
 *
 * 只给表名而不给整句 UPDATE：整句里要带参数号（`$1` / `$6`），而这条语句是拼进
 * 一条更大的 CTE 里的，参数号得跟外面那串对齐。之前写成整句再 `.replace('$2','$6')`，
 * 那种改法在参数顺序一动就静默错位，而错位的后果是「状态迁到了错的值」。
 */
const TARGET_TABLE: Readonly<Record<ModerationTargetType, string>> = {
  post: 'posts',
  post_image: 'post_images',
};

/** PostgreSQL 实现（DATABASE_URL 存在时经 ModerationModule 工厂注入）。 */
@Injectable()
export class PostgresModerationRepository implements ModerationRepository {
  constructor(private readonly pool: Pool) {}

  async findTarget(ref: ModerationTargetRef): Promise<ModerationTarget | null> {
    const { rows } = await this.pool.query<{ status: AuditStatus; author_id: string }>(
      TARGET_SELECT[ref.targetType],
      [ref.targetId],
    );
    if (!rows[0]) return null;
    return {
      targetType: ref.targetType,
      targetId: ref.targetId,
      status: rows[0].status,
      authorId: rows[0].author_id,
    };
  }

  /**
   * 三件事一条语句。
   *
   * `queued` 先走：它带 `ON CONFLICT DO NOTHING`（撞的是
   * `moderation_tasks_open_target_idx` 那个部分唯一索引），没插进去说明已经有
   * 未处理工单 —— 那就是幂等分支，另外两条子语句必须一起不生效。
   *
   * 靠 `WHERE EXISTS (SELECT 1 FROM queued)` 把状态迁移与流水挂在「真的入队了」
   * 之上。数据修改型 CTE 的子语句各执行一次、执行到底，所以不必开事务；而分成
   * 三次往返的话，中间崩掉会留下「状态改了但没工单」的半截状态。
   *
   * 注意 CTE 里的子语句看到的是**语句开始时**的快照，所以 `queued` 的插入结果
   * 只能靠 `RETURNING` 传给别的子语句，不能靠再查一次表。
   */
  async report(input: ReportInput): Promise<ModerationTaskRow | null> {
    const { target, entry } = input;
    const { rows } = await this.pool.query<{
      id: string;
      target_type: ModerationTargetType;
      target_id: string;
      source: ModerationSource;
      reported_by: string | null;
      reason: ReportReason | null;
      result: 'approved' | 'rejected' | null;
      handled_by: string | null;
      handled_at: Date | null;
      created_at: Date;
    }>(
      `WITH queued AS (
         INSERT INTO moderation_tasks
           (id, target_type, target_id, source, reported_by, reason)
         VALUES ($1, $2, $3, 'user_report', $4, $5)
         ON CONFLICT (target_type, target_id) WHERE result IS NULL DO NOTHING
         RETURNING id, target_type, target_id, source, reported_by, reason,
                   result, handled_by, handled_at, created_at
       ), moved AS (
         UPDATE ${TARGET_TABLE[target.targetType]} SET audit_status = $6
          WHERE id = $3 AND EXISTS (SELECT 1 FROM queued)
         RETURNING 1
       ), logged AS (
         INSERT INTO audit_log
           (id, actor_id, action, target_type, target_id, status_before, status_after)
         SELECT $7, $8, $9, $2, $3, $10, $6 WHERE EXISTS (SELECT 1 FROM queued)
         RETURNING 1
       )
       SELECT * FROM queued`,
      [
        randomUUID(),
        target.targetType,
        target.targetId,
        input.reporterId,
        input.reason,
        input.statusAfter,
        randomUUID(),
        entry.actorId,
        entry.action,
        entry.statusBefore,
      ],
    );
    return rows[0] ? toTaskRow(rows[0]) : null;
  }

  async listOpenTasksByTarget(ref: ModerationTargetRef): Promise<ModerationTaskRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, target_type, target_id, source, reported_by, reason,
              result, handled_by, handled_at, created_at
         FROM moderation_tasks
        WHERE target_type = $1 AND target_id = $2 AND result IS NULL
        ORDER BY created_at, id`,
      [ref.targetType, ref.targetId],
    );
    return rows.map(toTaskRow);
  }

  async findTaskById(taskId: string): Promise<ModerationTaskRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, target_type, target_id, source, reported_by, reason,
              result, handled_by, handled_at, created_at
         FROM moderation_tasks WHERE id = $1`,
      [taskId],
    );
    return rows[0] ? toTaskRow(rows[0]) : null;
  }

  /** 多取一条判 hasMore，省一次 count（同 `PostgresPostRepository.list`）。 */
  async listOpenTasks(opts: { page: number; pageSize: number }): Promise<{
    items: ModerationTaskWithContent[];
    hasMore: boolean;
  }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const { rows } = await this.pool.query<
      Parameters<typeof toTaskRow>[0] & {
        content: string | null;
        image_urls: string[];
        author_nickname: string | null;
      }
    >(`${SELECT_OPEN_TASKS} LIMIT $1 OFFSET $2`, [opts.pageSize + 1, offset]);
    const items = rows.slice(0, opts.pageSize).map((row) => ({
      ...toTaskRow(row),
      // 目标被删掉的空壳工单：内容取不到就给空串，不让整页 500。
      content: row.content ?? '',
      imageUrls: row.image_urls ?? [],
      authorNickname: row.author_nickname ?? '',
    }));
    return { items, hasMore: rows.length > opts.pageSize };
  }

  /** 已处理的一页，倒序。多取一条判 hasMore（同待办那条）。 */
  async listHandledTasks(opts: { page: number; pageSize: number }): Promise<{
    items: HandledTaskRow[];
    hasMore: boolean;
  }> {
    const offset = (opts.page - 1) * opts.pageSize;
    const { rows } = await this.pool.query<
      Parameters<typeof toTaskRow>[0] & {
        content: string | null;
        image_urls: string[];
        author_nickname: string | null;
        handled_by_username: string | null;
        handled_by_nickname: string | null;
      }
    >(`${SELECT_HANDLED_TASKS} LIMIT $1 OFFSET $2`, [opts.pageSize + 1, offset]);
    const items = rows.slice(0, opts.pageSize).map((row) => {
      const base = toTaskRow(row);
      return {
        ...base,
        // WHERE 里是 `result IS NOT NULL`，所以这两个一定有值 —— 断言而不是判空，
        // 让类型上的「不可空」名副其实。
        result: base.result as 'approved' | 'rejected',
        handledAt: base.handledAt as Date,
        // 目标被删掉的工单**照样出现**：这是历史，判过什么必须查得到。
        content: row.content ?? '',
        imageUrls: row.image_urls ?? [],
        authorNickname: row.author_nickname ?? '',
        // 运营账号的显示名是 username，微信用户没有那一列 —— 回落到昵称。
        handledByName: row.handled_by_username ?? row.handled_by_nickname ?? null,
      };
    });
    return { items, hasMore: rows.length > opts.pageSize };
  }

  /**
   * 拿票 + 状态迁移 + 写流水，一条语句。
   *
   * `claimed` 是**带条件的 UPDATE**（`AND result IS NULL`）：它没返回行就说明别人
   * 先处理了，另外两条子语句靠 `WHERE EXISTS (SELECT 1 FROM claimed)` 一起不生效。
   * 不做「先 SELECT 判断再 UPDATE」——那两步之间有窗口，两个运营同时点会双双通过。
   */
  async resolve(input: ResolveInput): Promise<ModerationTaskRow | null> {
    const { target, entry } = input;
    // 驳回原因只有 `posts` 有那一列，所以它排在参数表**最后**：图片那一支不传第 10 个
    // 参数，前九个的编号因此不受影响。（PG 对「传了但语句里没引用」的参数会直接报
    // bind 参数个数不符，所以不能靠占位敷衍过去。）
    const params: unknown[] = [
      input.taskId,
      input.result,
      input.moderatorId,
      target.targetId,
      input.statusAfter,
      randomUUID(),
      entry.action,
      target.targetType,
      entry.statusBefore,
    ];
    if (target.targetType === 'post') params.push(input.rejectReason);

    const { rows } = await this.pool.query<Parameters<typeof toTaskRow>[0]>(
      `WITH claimed AS (
         UPDATE moderation_tasks
            SET result = $2, handled_by = $3, handled_at = now()
          WHERE id = $1 AND result IS NULL
         RETURNING id, target_type, target_id, source, reported_by, reason,
                   result, handled_by, handled_at, created_at
       ), moved AS (
         ${TARGET_RESOLVE_UPDATE[target.targetType]}
           AND EXISTS (SELECT 1 FROM claimed)
         RETURNING 1
       ), logged AS (
         INSERT INTO audit_log
           (id, actor_id, action, target_type, target_id, status_before, status_after)
         SELECT $6, $3, $7, $8, $4, $9, $5 WHERE EXISTS (SELECT 1 FROM claimed)
         RETURNING 1
       )
       SELECT * FROM claimed`,
      params,
    );
    return rows[0] ? toTaskRow(rows[0]) : null;
  }
}

/**
 * 待处理工单一页，连带被举报内容的原文。
 *
 * 多态目标用两组 LEFT JOIN 摊平，而不是按类型分两条语句：分页要跨类型排序，
 * 两条语句就得在应用层合并再切片，那等于把 LIMIT 做废（同「过滤必须在 SQL 里」
 * 的理由）。`target_type` 的比较是 SQL 里的单个 `=`，不是 TS 的状态字面量比较。
 *
 * 图片类工单的 `image_urls` 只有被举报那一张 —— 举报指向的是这张图，不是整条动态。
 */
/**
 * 工单 + 内容原文的公共部分（`SELECT` 到 `FROM ... JOIN`）。
 *
 * 多态目标用两组 LEFT JOIN 摊平，而不是按类型分两条语句：分页要跨类型排序，
 * 两条语句就得在应用层合并再切片，那等于把 LIMIT 做废（同「过滤必须在 SQL 里」
 * 的理由）。`target_type` 的比较是 SQL 里的单个 `=`，不是 TS 的状态字面量比较。
 *
 * 图片类工单的 `image_urls` 只有被举报那一张 —— 举报指向的是这张图，不是整条动态。
 *
 * 提成常量给两个列表共用：待办与历史查的是同一批列、同一组 JOIN，只有 WHERE 与
 * ORDER BY 不同。抄两份的话，将来给工单加一列会漏改一处。
 */
const TASK_WITH_CONTENT_FROM = `
  SELECT t.id, t.target_type, t.target_id, t.source, t.reported_by, t.reason,
         t.result, t.handled_by, t.handled_at, t.created_at,
         COALESCE(po.content, pip.content) AS content,
         CASE WHEN t.target_type = 'post_image' THEN json_build_array(pi.url)
              ELSE COALESCE((
                SELECT json_agg(x.url ORDER BY x.sort_order, x.id)
                  FROM post_images x WHERE x.post_id = po.id
              ), '[]'::json)
         END AS image_urls,
         au.nickname AS author_nickname,
         hu.username AS handled_by_username,
         hu.nickname AS handled_by_nickname
    FROM moderation_tasks t
    LEFT JOIN posts po ON t.target_type = 'post' AND po.id = t.target_id
    LEFT JOIN post_images pi ON t.target_type = 'post_image' AND pi.id = t.target_id
    LEFT JOIN posts pip ON t.target_type = 'post_image' AND pip.id = pi.post_id
    LEFT JOIN users au ON au.id = COALESCE(po.author_id, pip.author_id)
    LEFT JOIN users hu ON hu.id = t.handled_by
`;

/** 待处理的一页，按举报时间**正序** —— 先举报的先处理。 */
const SELECT_OPEN_TASKS = `${TASK_WITH_CONTENT_FROM}
   WHERE t.result IS NULL
   ORDER BY t.created_at, t.id
`;

/**
 * 已处理的一页，按处理时间**倒序** —— 最近判的先看到，与待办正好相反。
 *
 * `id DESC` 兜同一时刻的两条（批量复核时 `handled_at` 可能相同）：只按时间排
 * 会让分页在页边界上漏行或重复，同 `audit_log` 那边的理由。
 */
const SELECT_HANDLED_TASKS = `${TASK_WITH_CONTENT_FROM}
   WHERE t.result IS NOT NULL
   ORDER BY t.handled_at DESC, t.id DESC
`;

/**
 * 目标类型 → 复核时的 UPDATE 片段。同 `TARGET_TABLE`，是定值表，不来自请求。
 *
 * 两支的差别不只是表名：`reject_reason` 只有 `posts` 有那一列，图片没有。
 * 所以整句写在表里（而不是只给表名再拼），谁带那一列一眼看得见。
 */
const TARGET_RESOLVE_UPDATE: Readonly<Record<ModerationTargetType, string>> = {
  post: `UPDATE posts SET audit_status = $5, reject_reason = $10 WHERE id = $4`,
  post_image: `UPDATE post_images SET audit_status = $5 WHERE id = $4`,
};

function toTaskRow(row: {
  id: string;
  target_type: ModerationTargetType;
  target_id: string;
  source: ModerationSource;
  reported_by: string | null;
  reason: ReportReason | null;
  result: 'approved' | 'rejected' | null;
  handled_by: string | null;
  handled_at: Date | null;
  created_at: Date;
}): ModerationTaskRow {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    source: row.source,
    reportedBy: row.reported_by,
    reason: row.reason,
    result: row.result,
    handledBy: row.handled_by,
    handledAt: row.handled_at,
    createdAt: row.created_at,
  };
}
