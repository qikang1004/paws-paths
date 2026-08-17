// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPubliclyVisible = exports.assertTransition = exports.canTransition = exports.AuditTransitionError = void 0;
/**
 * 状态机对应 spec §4.5。
 * rejected → pending 是作者修改重提通道（spec §6）。
 * pending_review → approved 是举报不成立时恢复可见。
 */
const ALLOWED = {
    pending: ['approved', 'rejected'],
    approved: ['pending_review'],
    pending_review: ['approved', 'rejected'],
    rejected: ['pending'],
};
class AuditTransitionError extends Error {
    constructor(from, to) {
        super(`illegal audit transition: ${from} -> ${to}`);
        this.from = from;
        this.to = to;
        this.name = 'AuditTransitionError';
    }
}
exports.AuditTransitionError = AuditTransitionError;
function canTransition(from, to) {
    return ALLOWED[from].includes(to);
}
exports.canTransition = canTransition;
function assertTransition(from, to) {
    if (!canTransition(from, to)) {
        throw new AuditTransitionError(from, to);
    }
}
exports.assertTransition = assertTransition;
/** 未达 approved 的内容对他人一律不可见，作者本人另行渲染「审核中」角标。 */
function isPubliclyVisible(status) {
    return status === 'approved';
}
exports.isPubliclyVisible = isPubliclyVisible;
