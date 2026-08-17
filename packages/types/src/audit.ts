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
