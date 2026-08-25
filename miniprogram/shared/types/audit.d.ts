// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
export type AuditStatus = 'pending' | 'approved' | 'rejected' | 'pending_review';
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
