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
