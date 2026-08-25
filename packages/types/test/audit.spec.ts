import {
  assertTransition,
  AUDIT_STATUSES,
  AuditTransitionError,
  canTransition,
  isPubliclyVisible,
  isVisibleTo,
  type AuditStatus,
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

/**
 * 可见性的两个维度：状态 + 是否作者本人。spec §4.5「未达 approved 的内容对他人
 * 不可见，对作者本人显示审核中角标」—— 这是通过小程序审核的必要条件。
 */
describe('isVisibleTo', () => {
  const ALL: readonly AuditStatus[] = ['pending', 'approved', 'pending_review', 'rejected'];

  it('作者本人能看到自己的全部内容（含未过审与被驳回）', () => {
    for (const status of ALL) {
      expect(isVisibleTo(status, true)).toBe(true);
    }
  });

  it('他人只能看到 approved', () => {
    expect(isVisibleTo('approved', false)).toBe(true);
    expect(isVisibleTo('pending', false)).toBe(false);
    expect(isVisibleTo('rejected', false)).toBe(false);
  });

  it('被举报进入复审的内容对他人立即不可见 —— 先撤下再复核', () => {
    expect(isVisibleTo('pending_review', false)).toBe(false);
    // 对作者仍可见，让他知道内容正在复核而不是凭空消失
    expect(isVisibleTo('pending_review', true)).toBe(true);
  });

  it('与 isPubliclyVisible 对非作者的判定完全一致', () => {
    for (const status of ALL) {
      expect(isVisibleTo(status, false)).toBe(isPubliclyVisible(status));
    }
  });
});

/**
 * `AUDIT_STATUSES` 是 SQL 侧「对外可见的状态有哪些」的来源（`= ANY($n)`）。
 * 它必须真的是全集 —— 漏一个状态，那个状态就会在可见性过滤里被静默漏掉。
 */
describe('AUDIT_STATUSES', () => {
  it('是全部四个状态，不是抄来的子集', () => {
    expect([...AUDIT_STATUSES].sort()).toEqual(
      (['approved', 'pending', 'pending_review', 'rejected'] as AuditStatus[]).sort(),
    );
  });

  it('每一个都能作为迁移起点被状态机识别（即真的在迁移表里登记过）', () => {
    for (const status of AUDIT_STATUSES) {
      // 未登记的状态会让 canTransition 读到 undefined 而抛 TypeError。
      expect(() => canTransition(status, 'approved')).not.toThrow();
    }
  });

  it('筛出对外可见的那些 —— 只有 approved', () => {
    expect(AUDIT_STATUSES.filter(isPubliclyVisible)).toEqual(['approved']);
  });
});
