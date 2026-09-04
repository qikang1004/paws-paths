import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  assertTransition,
  canTransition,
  ERROR_CODES,
  isVisibleTo,
  AUDIT_ACTIONS,
  MODERATION_TARGET_TYPES,
  REPORT_REASONS,
  type AuditAction,
  type AuditLogDto,
  type AuditStatus,
  type HandledTaskDto,
  type ModerationFilter,
  type ModerationTargetType,
  type ModerationTaskDto,
  type ReportReason,
  type ResolveTaskRequest,
} from '@paws/types';
import { ApiException } from '../common/api.exception';
import {
  AUDIT_LOG_REPOSITORY,
  type AuditLogRepository,
  type AuditLogRowWithActor,
} from './audit-log.repository';
import {
  MODERATION_REPOSITORY,
  type HandledTaskRow,
  type ModerationRepository,
  type ModerationTarget,
  type ModerationTaskWithContent,
} from './moderation.repository';

/**
 * 举报要把内容迁到的状态。
 *
 * 单独具名而不在判断里写字面量：`audit-literal-guard.spec.ts` 禁止手写状态比较，
 * 而这里需要的是「目标状态」这个值本身，不是比较 —— 合法性一律交给
 * `canTransition` / `assertTransition`（状态机唯一实现点）。
 */
const REPORTED_STATUS: AuditStatus = 'pending_review';

/** 举报成功的响应。刻意不下发工单 id —— 举报人不该拿到运营侧的句柄。 */
export interface ReportResponse {
  targetType: ModerationTargetType;
  targetId: string;
  /** 迁移后的状态。幂等分支返回的也是这个值（内容已经撤下了）。 */
  status: AuditStatus;
}

/**
 * 复核的两种结论 → 目标要迁到的状态、写进流水的动作、要不要驳回原因。
 *
 * 一张表而不是几个 if，有两个理由：加一种结论时漏改一处的可能性归零；而且
 * 「这个 result 合不合法」变成查表（`raw in REVIEW_OUTCOME`），不必拿结论去跟
 * 字面量比 —— `audit-literal-guard.spec.ts` 会拦下那种写法。那条守卫拦的本是
 * 状态字面量（它扫的是文本，连注释里的比较写法也算），而复核结论恰好与两个状态
 * 同名，撞得实实在在。
 */
const REVIEW_OUTCOME: Readonly<
  Record<ResolveResult, { status: AuditStatus; action: AuditAction; needsReason: boolean }>
> = {
  approved: { status: 'approved', action: 'review_approve', needsReason: false },
  rejected: { status: 'rejected', action: 'review_reject', needsReason: true },
};

/** 复核的结论。两个值来自 `@paws/types` 的 `ResolveTaskRequest`。 */
type ResolveResult = ResolveTaskRequest['result'];

/** 校验过的复核入参。 */
export interface ResolveBody {
  result: ResolveResult;
  /** 驳回原因。放行时恒为 null —— 放行没有原因可写。 */
  rejectReason: string | null;
}

/** 复核成功的响应。 */
export interface ResolveResponse {
  taskId: string;
  targetType: ModerationTargetType;
  targetId: string;
  result: ResolveResult;
  /** 迁移后的状态。与 `result` 同源（见 `REVIEW_OUTCOME`），下发出去省客户端再映射。 */
  status: AuditStatus;
}

/** 工单列表的一页。形状与其他列表端点一致（`items` / `hasMore` / `page`）。 */
export interface TaskListResponse {
  items: ModerationTaskDto[];
  hasMore: boolean;
  page: number;
}

/** 已处理工单的一页。 */
export interface HandledTaskListResponse {
  items: HandledTaskDto[];
  hasMore: boolean;
  page: number;
}

/** 流水列表的一页。形状与其他列表端点一致。 */
export interface AuditLogListResponse {
  items: AuditLogDto[];
  hasMore: boolean;
  page: number;
}

/** 校验过的举报入参。 */
export interface ReportBody {
  targetType: ModerationTargetType;
  targetId: string;
  reason: ReportReason;
}

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

/**
 * 请求体校验。导出在服务层，让控制器只管取参数、不管规则（同 `parsePostCreate`）。
 *
 * `target_type` 的白名单在**服务端**定义，不接受客户端传入未知类型
 * （Global Constraint 31）。它单独用 `MODERATION_TARGET_INVALID` 而不是通用的
 * `VALIDATION_FAILED`：客户端要能认出「这个类型服务端压根不支持」——那种错重试也没用。
 */
export function parseReport(body: Record<string, unknown>): ReportBody {
  const targetType = body.targetType;
  if (
    typeof targetType !== 'string' ||
    !(MODERATION_TARGET_TYPES as readonly string[]).includes(targetType)
  ) {
    throw new ApiException(
      ERROR_CODES.MODERATION_TARGET_INVALID,
      undefined,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) fail('缺少举报目标 id');

  const reason = body.reason;
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    // 自由文本不是合法原因：那本身是一条新的 UGC 入口，本阶段不引入。
    fail('请选择一个举报原因');
  }

  return {
    targetType: targetType as ModerationTargetType,
    targetId,
    reason: reason as ReportReason,
  };
}

/**
 * 筛选参数的校验，三个列表端点共用。
 *
 * **枚举值一律走白名单**（Global Constraint 31：白名单在服务端定义）。非法值是
 * 422 而不是「静默当没筛」—— 后者会让客户端以为筛生效了，而实际返回的是全量，
 * 那种错在界面上表现成「筛选按钮没反应」，极难查。
 *
 * `allowed` 指定这个端点认哪几个维度。**没列进去的字段直接忽略**，不报错 ——
 * 那样客户端可以把同一个筛选器状态原样发给任一端点（流水页发过来的 `action`
 * 在工单端点上无意义，但不该因此拒绝整个请求）。
 */
export function parseModerationFilter(
  q: Record<string, string | undefined>,
  allowed: readonly (keyof ModerationFilter)[],
): ModerationFilter {
  const filter: ModerationFilter = {};
  const pick = <T extends string>(
    key: keyof ModerationFilter,
    whitelist: readonly string[],
    label: string,
  ): T | undefined => {
    if (!allowed.includes(key)) return undefined;
    const raw = q[key];
    // 空串按「没传」处理：前端把筛选器清空时最自然的写法就是 `?reason=`。
    if (raw == null || raw === '') return undefined;
    if (!whitelist.includes(raw)) fail(`非法的${label}：${raw}`);
    return raw as T;
  };

  const targetType = pick<ModerationTargetType>('targetType', MODERATION_TARGET_TYPES, '目标类型');
  if (targetType) filter.targetType = targetType;

  const reason = pick<ReportReason>('reason', REPORT_REASONS, '举报原因');
  if (reason) filter.reason = reason;

  const result = pick<'approved' | 'rejected'>('result', ['approved', 'rejected'], '复核结论');
  if (result) filter.result = result;

  const action = pick<AuditAction>('action', AUDIT_ACTIONS, '审核动作');
  if (action) filter.action = action;

  return filter;
}

/**
 * 「某条内容的审核历史」的查询参数校验。
 *
 * 与 `parseReport` 用同一份白名单和同一个错误码（`MODERATION_TARGET_INVALID`）——
 * 客户端要能认出「这个类型服务端压根不支持」，那种错重试也没用。
 *
 * 单独一个 parser 而不复用 `parseReport`：那个要 `reason`，而查历史没有原因可填。
 */
export function parseTargetRef(query: Record<string, string | undefined>): {
  targetType: ModerationTargetType;
  targetId: string;
} {
  const targetType = query.targetType;
  if (
    typeof targetType !== 'string' ||
    !(MODERATION_TARGET_TYPES as readonly string[]).includes(targetType)
  ) {
    throw new ApiException(
      ERROR_CODES.MODERATION_TARGET_INVALID,
      undefined,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  const targetId = (query.targetId ?? '').trim();
  if (!targetId) fail('缺少目标 id');
  return { targetType: targetType as ModerationTargetType, targetId };
}

/**
 * 复核请求体的校验。
 *
 * `result` 的白名单在服务端定义 —— 客户端传 `pending` 之类的第三个值一律 422。
 * 用通用的 `VALIDATION_FAILED`（不是 `MODERATION_TARGET_INVALID`）：那个码是给
 * 「未知 target_type」留的，两者的客户端处置不同（后者重试也没用）。
 */
export function parseResolve(body: Record<string, unknown>): ResolveBody {
  const raw = body.result;
  // `in` 而不是 Object.hasOwn：项目的 tsconfig target 还在 ES2021。
  // REVIEW_OUTCOME 是本文件的字面量对象，原型链上没有可撞的键。
  if (typeof raw !== 'string' || !(raw in REVIEW_OUTCOME)) {
    fail('复核结论只能是 approved 或 rejected');
  }
  const result = raw as ResolveResult;
  const { needsReason } = REVIEW_OUTCOME[result];

  const reason = typeof body.rejectReason === 'string' ? body.rejectReason.trim() : '';
  if (needsReason && !reason) fail('驳回必须写明原因');
  // 放行时把原因丢掉：放行没有原因可写，留着只会在作者那边显示一条陈旧的驳回理由。
  return { result, rejectReason: needsReason ? reason : null };
}

@Injectable()
export class ModerationService {
  constructor(
    @Inject(MODERATION_REPOSITORY) private readonly moderation: ModerationRepository,
    @Inject(AUDIT_LOG_REPOSITORY) private readonly auditLog: AuditLogRepository,
  ) {}

  /**
   * 举报一条内容：`approved → pending_review`，内容立即对他人不可见。
   *
   * **判定顺序是这条路径上最要紧的事**（Global Constraint 26）：
   * 先按「这个人能不能看见这条内容」判 404，**再**判状态机。顺序反了，举报一条
   * `pending` 动态会因为 `assertTransition` 抛出而变成 422，把「这条 id 存在但
   * 状态不是 approved」泄露给探测者。
   *
   * 所以下面三种情况的响应**完全一致**（404，body 一字不差）：
   *   ① 目标不存在；② 目标存在但这个人看不见它；③ 看得见但状态机不允许这次迁移。
   * ③ 里唯一的例外是已经被举报过的（`pending_review`）—— 那条走幂等分支返回 200，
   * 因为那条内容对举报人已经不可见了，但他刚刚举报的动作确实成功了。
   */
  async report(reporterId: string, body: ReportBody): Promise<ReportResponse> {
    const target = await this.moderation.findTarget(body);
    // ① 不存在，与「看不见」同一个响应。
    if (!target) throw this.notFound();

    // 已经在队列里：幂等成功，不产生第二条工单、不重复写流水、不报错
    // （Global Constraint 27）。
    //
    // **判在可见性之前**，这是 Global Constraint 26 上一处有意的例外：内容一旦被
    // 举报就迁到了 `pending_review`，对举报人自己也不可见了 —— 若先判可见性，
    // 举报人重复点一次会拿到 404，等于告诉他「刚才那次举报没成功」，而实际上成功了。
    // 泄露面被限死在「这条 id 正在复核中」这一位信息上：不回内容、不回工单 id、
    // 不回举报人，响应与新建工单时完全一致。而队列里有工单必然意味着真有人举报过它
    // （机审那条路径不入队，见 Task 1），所以探测者拿不到「任意 id 是否存在」。
    const open = await this.moderation.listOpenTasksByTarget(body);
    if (open.length > 0) return this.projection(target.targetType, target.targetId);

    // ② 看不见（`pending` / `rejected` 对非作者）。判在状态机之前。
    if (!isVisibleTo(target.status, target.authorId === reporterId)) throw this.notFound();

    // ③ 看得见但迁不过去（作者举报自己那条 `pending` 的）。仍是 404，不是 422。
    if (!canTransition(target.status, REPORTED_STATUS)) throw this.notFound();

    return this.open(target, reporterId, body.reason);
  }

  /** 真正落三件事。走到这里迁移一定合法，`assertTransition` 是最后一道断言。 */
  private async open(
    target: ModerationTarget,
    reporterId: string,
    reason: ReportReason,
  ): Promise<ReportResponse> {
    // 状态机唯一实现点（Global Constraint 15）。上面已用 canTransition 判过，
    // 这里再断言一次是为了「改状态」这个动作本身永远经过状态机。
    assertTransition(target.status, REPORTED_STATUS);

    await this.moderation.report({
      target,
      reporterId,
      reason,
      statusAfter: REPORTED_STATUS,
      // 与状态迁移同一条语句写下（Global Constraint 24）：状态改了而流水没写，
      // 等于审核动作凭空发生。
      entry: {
        actorId: reporterId,
        action: 'report',
        targetType: target.targetType,
        targetId: target.targetId,
        statusBefore: target.status,
        statusAfter: REPORTED_STATUS,
      },
    });
    // `report` 返回 null 表示并发的另一次举报先入队了 —— 那也是幂等成功，
    // 响应与新建工单时一致（内容都已经是 pending_review 了）。
    return this.projection(target.targetType, target.targetId);
  }

  private projection(targetType: ModerationTargetType, targetId: string): ReportResponse {
    return { targetType, targetId, status: REPORTED_STATUS };
  }

  /**
   * 待处理工单的一页（运营侧）。
   *
   * 这条路径上**刻意不做可见性过滤**：`isVisibleTo` 会把 `pending_review` 的内容
   * 对非作者藏起来，而运营正是非作者、又必须看得见要判的东西。这是 Global
   * Constraint 16 上一处有意的例外，把关的是 `ModeratorGuard` 而不是可见性判定。
   */
  async listTasks(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<TaskListResponse> {
    const { items, hasMore } = await this.moderation.listOpenTasks(opts);
    return { items: items.map(toTaskDto), hasMore, page: opts.page };
  }

  /**
   * 已处理工单的一页，按处理时间倒序。
   *
   * 与 `listTasks` 是两个端点而不是一个带 `status` 参数的：排序相反（待办按举报
   * 时间正序、历史按处理时间倒序），下发的字段也不同（历史必带 `result` 与
   * `handledBy`，而待办那边刻意不下发 —— 下发只会诱导客户端判空）。
   *
   * 与流水页的分别：这里能看到**当初判的是什么内容**（举报原因、正文、图片），
   * 而流水只有动作与状态变化。代价是目标被删后内容为空 —— 那正是流水不带原文的理由。
   */
  async listHandledTasks(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<HandledTaskListResponse> {
    const { items, hasMore } = await this.moderation.listHandledTasks(opts);
    return { items: items.map(toHandledTaskDto), hasMore, page: opts.page };
  }

  /**
   * 某条内容的**完整**审核历史，不分页。
   *
   * 不分页是有意的：一条内容的流水撑不到要分页（举报一次写一条、复核一次写一条，
   * 机审最多再两条）。加分页只会让调用方多一段翻页代码去处理永远只有一页的数据。
   *
   * 与全局流水共用同一个 DTO —— 字段完全一样，只是筛了目标。`actorName` 在这条
   * 路径上恒为 null：`listByTarget` 不 JOIN users（它的主调用点在复核流程里，
   * 那里不需要显示名）。前端据此显示 id 而不是名字，这一点记在端点注释里。
   */
  async listAuditLogsByTarget(ref: {
    targetType: ModerationTargetType;
    targetId: string;
  }): Promise<{ items: AuditLogDto[] }> {
    const rows = await this.auditLog.listByTarget(ref.targetType, ref.targetId);
    return { items: rows.map((row) => toAuditLogDto({ ...row, actorName: null })) };
  }

  /**
   * 审核流水的一页（运营侧的合规视图）。
   *
   * 与工单列表分开的理由是**职责**：工单是待办队列（处理完就不在列表里），
   * 流水是只追加的记录 —— 「谁在什么时候把哪条内容怎么了」要能一直查得到，
   * 包括那条内容后来被作者删掉的情况。
   *
   * 这条路径上没有可见性过滤，同 `listTasks` —— 把关的是 `ModeratorGuard`。
   */
  async listAuditLogs(opts: {
    page: number;
    pageSize: number;
    filter?: ModerationFilter;
  }): Promise<AuditLogListResponse> {
    const { items, hasMore } = await this.auditLog.list(opts);
    return { items: items.map(toAuditLogDto), hasMore, page: opts.page };
  }

  /**
   * 复核一条工单：`pending_review → approved / rejected`。
   *
   * 「不存在」与「已被处理」是**两个不同的响应**（404 与 422），这与举报那条路径
   * 的取向相反 —— 那里分开会泄露内容存在性，而这里调用方是运营：他手上的工单 id
   * 本来就是列表给的，把「你点的这条别人刚处理完」告诉他才是对的。
   */
  async resolve(
    moderatorId: string,
    taskId: string,
    body: ResolveBody,
  ): Promise<ResolveResponse> {
    const task = await this.moderation.findTaskById(taskId);
    if (!task) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '工单不存在', HttpStatus.NOT_FOUND);
    }
    // 已处理的工单先在这里挡一次。真正的并发安全靠仓储里那条带条件的 UPDATE
    // 拿票 —— 这一层只是让「点了个早已关掉的工单」不必白跑一趟写操作。
    if (task.result !== null) throw this.alreadyHandled();

    const target = await this.moderation.findTarget(task);
    if (!target) {
      // 工单还在，目标没了（作者删了动态之类）。工单是队列，不是流水，
      // 这条已经无从复核 —— 与「工单不存在」同一个响应。
      throw new ApiException(ERROR_CODES.NOT_FOUND, '工单不存在', HttpStatus.NOT_FOUND);
    }

    const outcome = REVIEW_OUTCOME[body.result];
    // 状态机唯一实现点（Global Constraint 15）。两条边都在阶段 0 的迁移表里。
    assertTransition(target.status, outcome.status);

    const claimed = await this.moderation.resolve({
      taskId,
      target,
      moderatorId,
      result: body.result,
      statusAfter: outcome.status,
      rejectReason: body.rejectReason,
      // 与拿票、状态迁移同一条语句写下（Global Constraint 24）。
      entry: {
        actorId: moderatorId,
        action: outcome.action,
        targetType: target.targetType,
        targetId: target.targetId,
        statusBefore: target.status,
        statusAfter: outcome.status,
      },
    });
    // 没拿到票：并发的另一次复核先关了这条工单。它的状态迁移与流水都没生效
    // （靠 CTE 里的 `WHERE EXISTS (SELECT 1 FROM claimed)`）。
    if (!claimed) throw this.alreadyHandled();

    return {
      taskId,
      targetType: target.targetType,
      targetId: target.targetId,
      result: body.result,
      status: outcome.status,
    };
  }

  /** 并发复核的败者与「点了个已关工单」共用这一个。 */
  private alreadyHandled(): ApiException {
    return new ApiException(
      ERROR_CODES.MODERATION_TASK_HANDLED,
      '这条工单已经被处理过了',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** 三种情况共用的那一个 404。文案也共用 —— 分开写迟早分叉。 */
  private notFound(): ApiException {
    return new ApiException(ERROR_CODES.NOT_FOUND, '内容不存在', HttpStatus.NOT_FOUND);
  }
}

/**
 * 工单行 → DTO。
 *
 * 摘掉 `reportedBy` / `result` / `handledBy` / `handledAt`：运营按内容判，不按谁举报判
 * （下发举报人只会招来针对举报人的报复），而列表只出未处理的工单，下发后两个字段
 * 只会诱导客户端去判空。
 */
/**
 * 已处理工单行 → DTO。
 *
 * 与 `toTaskDto` 相反：这里**保留** `result` / `handledBy` / `handledAt`
 * （回看历史就是要看这几样），但同样摘掉 `reportedBy` —— 运营不该按谁举报判，
 * 回看时也不需要知道，而下发它只会让「针对举报人的报复」多一条路径。
 */
function toHandledTaskDto(row: HandledTaskRow): HandledTaskDto {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    result: row.result,
    handledBy: row.handledBy,
    handledByName: row.handledByName,
    handledAt: row.handledAt.toISOString(),
    content: row.content,
    imageUrls: row.imageUrls,
    authorNickname: row.authorNickname,
  };
}

function toAuditLogDto(row: AuditLogRowWithActor): AuditLogDto {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    statusBefore: row.statusBefore,
    statusAfter: row.statusAfter,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTaskDto(row: ModerationTaskWithContent): ModerationTaskDto {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    source: row.source,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    content: row.content,
    imageUrls: row.imageUrls,
    authorNickname: row.authorNickname,
  };
}
