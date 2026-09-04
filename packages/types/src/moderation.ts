import type { AuditStatus } from './audit';

/**
 * 举报与人工复核（spec §4.4）。
 *
 * 审核**状态机**不在这里 —— 它在 `audit.ts`，是唯一实现点（Global Constraint 15）。
 * 本阶段用到的三条边（`approved → pending_review`、`pending_review → approved`、
 * `pending_review → rejected`）阶段 0 就已定义并有单测，这里只加类型，不碰迁移表。
 */

/**
 * 运营角色。RBAC 的最小落法（spec §3.1：运营后台复用同一 API + RBAC 隔离）。
 *
 * 角色**不进 JWT**：令牌是阶段 0 签的，里面没有角色字段；而把角色塞进令牌会让
 * 「撤销运营权限」要等到令牌过期才生效。每次复核多一次 O(1) 查询，换即时可撤销。
 */
export const USER_ROLES = ['user', 'moderator', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * 举报能指向的目标。**只有这两个**：它们是唯一带 `audit_status` 列的表。
 *
 * `pet_photos` 不在内 —— 它没有那一列（spec §4.1/§4.5 声称有，实际没有，是既往
 * 未记的偏差），且宠物照片上传路径压根不过机审，没有机审结论可撤。宠物相册的
 * 安全边界目前由取图路由兜着（私有档对他人 404）。
 *
 * 白名单在服务端校验，客户端传未知类型是 422（`MODERATION_TARGET_INVALID`）。
 */
export const MODERATION_TARGET_TYPES = ['post', 'post_image'] as const;
export type ModerationTargetType = (typeof MODERATION_TARGET_TYPES)[number];

/**
 * 举报原因的固定白名单。
 *
 * 刻意**不做自由文本**：那本身是一条新的 UGC 入口，又要过一遍内容安全，
 * 本阶段不引入。运营在工单里看到的是这个枚举值加被举报内容的原文。
 */
export const REPORT_REASONS = [
  'spam',
  'abuse',
  'porn',
  'fraud',
  'animal_abuse',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** 举报原因的展示文案。客户端的单选列表直接吃这个，不各自硬编码一份。 */
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: '垃圾广告',
  abuse: '辱骂或人身攻击',
  porn: '色情低俗',
  fraud: '诈骗或虚假信息',
  animal_abuse: '虐待动物',
  other: '其他',
};

/**
 * 写进 `audit_log` 的动作。
 *
 * `auto_*` 两个是机审的动作，它们**没有操作人**（`actor_id` 为 NULL）——
 * 那不是人做的事。人工的三个动作一律带 `actor_id`。
 *
 * 没有 `delete`：审核不删内容，只改状态。撤下就是 `rejected`。
 */
export const AUDIT_ACTIONS = [
  'report',
  'review_approve',
  'review_reject',
  'auto_approve',
  'auto_reject',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** 工单来源。三个值与建表时的 CHECK 一致；本阶段机审不入队，`wx_auto` 是预留。 */
export const MODERATION_SOURCES = ['wx_auto', 'user_report', 'manual'] as const;
export type ModerationSource = (typeof MODERATION_SOURCES)[number];

/** `POST /reports` 的请求体。 */
export interface ReportRequest {
  targetType: ModerationTargetType;
  targetId: string;
  reason: ReportReason;
}

/**
 * 待处理工单。`GET /moderation/tasks` 的列表项。
 *
 * 带被举报内容的**完整原文**（`content` / `imageUrls`）：运营要看内容才能判。
 * `isVisibleTo` 在这条路径上不适用 —— 运营不是作者，但必须看得见 `pending_review`
 * 的内容。这是**有意的例外**，也是这个 DTO 与 `PostDto` 不能合并的原因。
 *
 * 不下发 `result` / `handledBy`：列表只出未处理的工单，下发这两个字段只会诱导
 * 客户端去判空。也不下发举报人是谁 —— 运营按内容判，不按谁举报判。
 */
export interface ModerationTaskDto {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  source: ModerationSource;
  reason: ReportReason | null;
  createdAt: string;
  content: string;
  imageUrls: string[];
  authorNickname: string;
}

/**
 * 一条**已处理**的工单。`GET /moderation/tasks/handled` 的列表项。
 *
 * 与 `ModerationTaskDto` 分成两个类型而不是把那几个字段改成可选：可选字段会让
 * 客户端在**两条路径上都**去判空，而实际上「未处理的工单没有结论」与
 * 「已处理的工单一定有结论」都是确定的。分开之后各自的必填就是真的必填。
 *
 * 带 `content` / `imageUrls`：回看时要知道当初判的是什么。但目标可能已被作者删掉
 * （`moderation_tasks.target_id` 是多态的、不挂外键），那时这两个字段是空的 ——
 * 这也正是 `AuditLogDto` 刻意不带原文的理由：流水要活得更久。
 */
export interface HandledTaskDto {
  id: string;
  targetType: ModerationTargetType;
  targetId: string;
  source: ModerationSource;
  reason: ReportReason | null;
  createdAt: string;
  /** 已处理的工单一定有结论 —— 这个字段不可空。 */
  result: 'approved' | 'rejected';
  /**
   * 复核人。可空 —— `handled_by` 挂的是 `ON DELETE SET NULL`：工单是队列不是流水，
   * 账号注销后把指针置空是可接受的（合规留痕由 `audit_log` 承担）。
   */
  handledBy: string | null;
  /** 复核人的显示名。`handledBy` 为 null 时它也是 null。 */
  handledByName: string | null;
  handledAt: string;
  /** 目标已被删除时是空串。 */
  content: string;
  imageUrls: string[];
  authorNickname: string;
}

/**
 * 一条审核流水。`GET /moderation/audit-logs` 的列表项。
 *
 * 与 `ModerationTaskDto` 的分别是**职责**，不是详略：工单是待办队列（会被更新、
 * 处理完就不在列表里），流水是只追加的合规记录（谁在什么时候把哪条内容怎么了）。
 * 所以这里下发的是**动作**与**操作人**，而工单那边刻意不下发举报人是谁。
 *
 * 不带被举报内容的原文：流水要比它记录的目标活得久 —— 动态被作者删了，
 * 那条「谁撤下了它」的记录仍然必须查得到。带原文会让这一半在删除后变成空字段，
 * 诱导客户端去判空。
 */
export interface AuditLogDto {
  id: string;
  /** 机审没有操作人 —— `null` 表示这条不是人做的。 */
  actorId: string | null;
  /**
   * 操作人的显示名（运营账号是用户名，微信用户是昵称）。
   *
   * `actorId` 有值但这里是 `null`：那个账号已经不在 `users` 表里了。
   * `audit_log.actor_id` **不挂外键**（流水必须比主体活得久），所以这是正常状态，
   * 不是数据损坏 —— 客户端该显示「已注销」而不是当成缺字段。
   */
  actorName: string | null;
  action: AuditAction;
  targetType: ModerationTargetType;
  targetId: string;
  statusBefore: AuditStatus;
  statusAfter: AuditStatus;
  createdAt: string;
}

/** 审核动作的展示文案。客户端直接吃这个，不各自硬编码一份。 */
export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  report: '用户举报',
  review_approve: '复核放行',
  review_reject: '复核撤下',
  auto_approve: '机审通过',
  auto_reject: '机审拒绝',
};

/**
 * 三个运营列表的筛选条件。
 *
 * 全部**可选**，缺省即不筛。做成一个共用的形状而不是每个端点各定一套：三条路径的
 * 筛选维度有重叠（目标类型三条都要、举报原因两条要），各定一套会让「加一个维度」
 * 要改三处，而客户端也得记三种参数名。
 *
 * 服务端按端点取自己认识的那几个字段，不认识的**静默忽略**而不是报错 ——
 * 那样客户端可以把同一个筛选器状态原样发给任一端点。
 */
export interface ModerationFilter {
  /** 目标类型。三个列表都支持。 */
  targetType?: ModerationTargetType;
  /** 举报原因。待复核与已处理支持；流水没有这一列。 */
  reason?: ReportReason;
  /** 复核结论。**只有已处理**支持 —— 待复核的恒为空，流水记的是动作不是结论。 */
  result?: 'approved' | 'rejected';
  /** 审核动作。**只有流水**支持。 */
  action?: AuditAction;
}

/** `POST /moderation/tasks/:id/resolve` 的请求体。 */
export interface ResolveTaskRequest {
  /** `approved` = 举报不成立，恢复可见；`rejected` = 举报成立，永久撤下。 */
  result: 'approved' | 'rejected';
  /** 驳回原因。作者能在「我的动态」里看到它，所以 `rejected` 时应当有值。 */
  rejectReason?: string;
}
