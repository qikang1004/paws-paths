import {
  assertTransition,
  AuditTransitionError,
  canTransition,
  isPubliclyVisible,
} from '../src/audit';

describe('审核状态机', () => {
  it('机审通过与机审驳回都是合法转移', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('pending', 'rejected')).toBe(true);
  });

  it('已通过的内容被举报后进入复审', () => {
    expect(canTransition('approved', 'pending_review')).toBe(true);
  });

  it('复审可人工通过或人工驳回', () => {
    expect(canTransition('pending_review', 'approved')).toBe(true);
    expect(canTransition('pending_review', 'rejected')).toBe(true);
  });

  it('驳回后允许作者修改重提', () => {
    expect(canTransition('rejected', 'pending')).toBe(true);
  });

  it('拦截跳过审核的非法转移', () => {
    expect(canTransition('rejected', 'approved')).toBe(false);
    expect(canTransition('pending', 'pending_review')).toBe(false);
    expect(canTransition('approved', 'rejected')).toBe(false);
  });

  it('assertTransition 对非法转移抛出可识别错误', () => {
    expect(() => assertTransition('rejected', 'approved')).toThrow(AuditTransitionError);
    expect(() => assertTransition('pending', 'approved')).not.toThrow();
  });

  it('只有 approved 对他人可见', () => {
    expect(isPubliclyVisible('approved')).toBe(true);
    expect(isPubliclyVisible('pending')).toBe(false);
    expect(isPubliclyVisible('pending_review')).toBe(false);
    expect(isPubliclyVisible('rejected')).toBe(false);
  });
});
