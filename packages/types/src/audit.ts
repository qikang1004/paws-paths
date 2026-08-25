export type AuditStatus = 'pending' | 'approved' | 'rejected' | 'pending_review';

/**
 * 状态机对应 spec §4.5。
 * rejected → pending 是作者修改重提通道（spec §6）。
 * pending_review → approved 是举报不成立时恢复可见。
 */
const ALLOWED: Record<AuditStatus, readonly AuditStatus[]> = {
  pending: ['approved', 'rejected'],
  approved: ['pending_review'],
  pending_review: ['approved', 'rejected'],
  rejected: ['pending'],
};

export class AuditTransitionError extends Error {
  constructor(
    readonly from: AuditStatus,
    readonly to: AuditStatus,
  ) {
    super(`illegal audit transition: ${from} -> ${to}`);
    this.name = 'AuditTransitionError';
  }
}

export function canTransition(from: AuditStatus, to: AuditStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(from: AuditStatus, to: AuditStatus): void {
  if (!canTransition(from, to)) {
    throw new AuditTransitionError(from, to);
  }
}

/** 未达 approved 的内容对他人一律不可见，作者本人另行渲染「审核中」角标。 */
export function isPubliclyVisible(status: AuditStatus): boolean {
  return status === 'approved';
}

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
export function isVisibleTo(status: AuditStatus, isAuthor: boolean): boolean {
  return isAuthor || isPubliclyVisible(status);
}
