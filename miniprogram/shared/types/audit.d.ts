// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
export type AuditStatus = 'pending' | 'approved' | 'rejected' | 'pending_review';
/**
 * 全部状态，从迁移表派生而不是另抄一份字面量数组 ——
 * 将来往状态机加一种状态，这份清单自动跟上。
 *
 * SQL 侧要它：可见性过滤必须写在 WHERE 里（过滤放到 LIMIT 之后会把分页算坏），
 * 而 `audit_status = ANY($n)` 的那个数组得先有一份完整清单可筛。
 */
export declare const AUDIT_STATUSES: readonly AuditStatus[];
export declare class AuditTransitionError extends Error {
    readonly from: AuditStatus;
    readonly to: AuditStatus;
    constructor(from: AuditStatus, to: AuditStatus);
}
export declare function canTransition(from: AuditStatus, to: AuditStatus): boolean;
export declare function assertTransition(from: AuditStatus, to: AuditStatus): void;
/** 未达 approved 的内容对他人一律不可见，作者本人另行渲染「审核中」角标。 */
export declare function isPubliclyVisible(status: AuditStatus): boolean;
/**
 * 可见性判定的唯一出口：状态 + 是否作者本人。
 *
 * 作者本人能看到自己的全部内容（`pending` 显示「审核中」角标、`rejected` 显示
 * 驳回原因），他人只能看到 `approved`。`pending_review` 对他人立即不可见 ——
 * 内容被举报后应先撤下再人工复核，而不是继续公开展示。
 *
 * 业务代码一律调这个函数，不要手写 `status === 'approved'`：spec §4.5 说
 * `pet_photos`/`posts`/`post_images`/`messages`/`pet_licenses` 共用状态机，
 * 散落的字面量比较迟早会在某条新路径上漏掉过滤，而「未 approved 对他人不可见」
 * 是小程序过审的必要条件。
 */
export declare function isVisibleTo(status: AuditStatus, isAuthor: boolean): boolean;
