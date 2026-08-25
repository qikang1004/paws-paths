// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isVisibleTo = exports.isPubliclyVisible = exports.assertTransition = exports.canTransition = exports.AuditTransitionError = exports.AUDIT_STATUSES = void 0;
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
/**
 * 全部状态，从迁移表派生而不是另抄一份字面量数组 ——
 * 将来往状态机加一种状态，这份清单自动跟上。
 *
 * SQL 侧要它：可见性过滤必须写在 WHERE 里（过滤放到 LIMIT 之后会把分页算坏），
 * 而 `audit_status = ANY($n)` 的那个数组得先有一份完整清单可筛。
 */
exports.AUDIT_STATUSES = Object.keys(ALLOWED);
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
function isVisibleTo(status, isAuthor) {
    return isAuthor || isPubliclyVisible(status);
}
exports.isVisibleTo = isVisibleTo;
