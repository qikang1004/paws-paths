import {
  ERROR_CODES,
  MODERATION_TARGET_TYPES,
  REPORT_REASONS,
  USER_ROLES,
  messageForCode,
  type AuditAction,
  type ModerationTargetType,
  type ModerationTaskDto,
  type ReportReason,
  type ReportRequest,
  type UserRole,
} from '../src';

// 与 social.spec.ts 同款：DTO 是纯类型，用 ts-jest 的编译当断言。
// `@ts-expect-error` 是反向断言 —— 那一行必须报错，不报错反而算失败。

describe('UserRole', () => {
  it('三个角色：普通用户、审核员、管理员', () => {
    expect(USER_ROLES).toEqual(['user', 'moderator', 'admin']);
  });

  it('是联合类型，不接受别的字符串', () => {
    // @ts-expect-error 只有三个角色
    const bad: UserRole = 'superadmin';
    expect(bad).toBe('superadmin');
  });

  /**
   * 角色**不进 JWT**（Global Constraint 28）：令牌是阶段 0 签的，里面没有角色字段；
   * 把角色塞进令牌会让「撤销运营权限」要等到令牌过期才生效。所以这里没有
   * 「令牌载荷含 role」的类型，是有意的空缺。
   */
  it('运营权限是 moderator 与 admin 两个 —— user 不是运营', () => {
    const staff: UserRole[] = ['moderator', 'admin'];
    expect(staff).not.toContain('user');
  });
});

describe('ModerationTargetType', () => {
  /**
   * 只有这两个：它们是唯一带 `audit_status` 列的表。`pet_photos` 没有那一列
   * （spec §4.1/§4.5 声称有，实际没有，是既往未记的偏差），宠物照片上传路径
   * 也不过机审，没有机审结论可撤，所以举报不覆盖它。
   */
  it('只有 post 与 post_image —— 它们是唯一带 audit_status 的表', () => {
    expect(MODERATION_TARGET_TYPES).toEqual(['post', 'post_image']);
  });

  it('不含 pet_photo —— 那张表没有 audit_status', () => {
    // @ts-expect-error 宠物照片不在举报范围内
    const bad: ModerationTargetType = 'pet_photo';
    expect(bad).toBe('pet_photo');
  });
});

describe('ReportReason', () => {
  it('是固定白名单，不做自由文本', () => {
    // 自由文本本身是 UGC，又要过一遍内容安全，本阶段不引入这条路径。
    expect(REPORT_REASONS.length).toBeGreaterThan(2);
    for (const r of REPORT_REASONS) expect(typeof r).toBe('string');
  });

  it('白名单之外的值不通过类型检查', () => {
    // @ts-expect-error 举报原因必须来自白名单
    const bad: ReportReason = '我就是看它不顺眼';
    expect(typeof bad).toBe('string');
  });
});

describe('AuditAction', () => {
  it('五个动作：举报、复核通过、复核驳回、机审通过、机审驳回', () => {
    const actions: AuditAction[] = [
      'report',
      'review_approve',
      'review_reject',
      'auto_approve',
      'auto_reject',
    ];
    expect(new Set(actions).size).toBe(5);
  });

  it('机审的两个动作单独列出 —— 它们没有操作人，actor 为 null', () => {
    const machine: AuditAction[] = ['auto_approve', 'auto_reject'];
    expect(machine).toHaveLength(2);
  });

  it('没有 delete 这类动作 —— 审核不删内容，只改状态', () => {
    // @ts-expect-error 状态机里没有「删除」这条边
    const bad: AuditAction = 'delete';
    expect(bad).toBe('delete');
  });
});

describe('ReportRequest', () => {
  it('目标类型 + 目标 id + 白名单原因', () => {
    const req: ReportRequest = {
      targetType: 'post',
      targetId: 'po-1',
      reason: REPORT_REASONS[0],
    };
    expect(req.targetId).toBe('po-1');
  });

  it('原因必填 —— 举报要有据可查，运营看的就是这个', () => {
    // @ts-expect-error 缺 reason
    const bad: ReportRequest = { targetType: 'post', targetId: 'po-1' };
    expect(bad.targetId).toBe('po-1');
  });

  it('不接受自由文本的补充说明 —— 那是一条新的 UGC 入口', () => {
    const bad: ReportRequest = {
      targetType: 'post',
      targetId: 'po-1',
      reason: REPORT_REASONS[0],
      // @ts-expect-error 本阶段不引入自由文本
      detail: '他骂我了',
    };
    expect(bad.targetId).toBe('po-1');
  });
});

describe('ModerationTaskDto', () => {
  const task: ModerationTaskDto = {
    id: 'mt-1',
    targetType: 'post',
    targetId: 'po-1',
    source: 'user_report',
    reason: REPORT_REASONS[0],
    createdAt: '2026-08-26T10:00:00.000Z',
    content: '被举报的动态原文',
    imageUrls: ['https://cdn.example.com/pi1.jpg'],
    authorNickname: '小陈',
  };

  /**
   * 工单项带被举报内容的**完整原文**：运营要看内容才能判。`isVisibleTo` 在这条
   * 路径上不适用（运营不是作者，但必须看得见 `pending_review` 的内容），这是
   * 有意的例外。
   */
  it('带被举报内容的原文与配图 —— 运营要看内容才能判', () => {
    expect(task.content).toContain('原文');
    expect(task.imageUrls).toHaveLength(1);
  });

  it('列表只出未处理的工单，所以不下发 result / handledBy', () => {
    const bad: ModerationTaskDto = {
      ...task,
      // @ts-expect-error 队列里全是未处理的，下发这两个字段只会诱导客户端判空
      result: null,
    };
    expect(bad.id).toBe('mt-1');
  });

  it('source 复用建表时的三个值', () => {
    const sources: ModerationTaskDto['source'][] = ['wx_auto', 'user_report', 'manual'];
    expect(sources).toHaveLength(3);
  });

  it('不下发举报人是谁 —— 运营按内容判，不按谁举报判', () => {
    const bad: ModerationTaskDto = {
      ...task,
      // @ts-expect-error 举报人身份不进工单列表
      reportedBy: 'u-1',
    };
    expect(bad.id).toBe('mt-1');
  });
});

describe('新增错误码', () => {
  /**
   * 号段接着既有的排：`42200`–`42203` 已用（VALIDATION_FAILED / AUDIT_REJECTED /
   * LOCATION_REQUIRED / FOLLOW_SELF），所以从 `42204` 起。
   */
  it('未知 target_type 是 42204', () => {
    expect(ERROR_CODES.MODERATION_TARGET_INVALID).toBe(42204);
  });

  it('工单已被别人处理是 42205（并发复核的败者拿这个）', () => {
    expect(ERROR_CODES.MODERATION_TASK_HANDLED).toBe(42205);
  });

  it('两个新码都有中文兜底文案', () => {
    for (const code of [
      ERROR_CODES.MODERATION_TARGET_INVALID,
      ERROR_CODES.MODERATION_TASK_HANDLED,
    ]) {
      const msg = messageForCode(code);
      expect(msg).not.toBe('服务异常，请稍后再试');
      expect(msg.length).toBeGreaterThan(3);
    }
  });

  it('没有 ALREADY_REPORTED —— 重复举报是幂等成功，不是错误', () => {
    expect(Object.keys(ERROR_CODES)).not.toContain('ALREADY_REPORTED');
  });

  it('越权复核复用既有的 FORBIDDEN，不新开码', () => {
    expect(ERROR_CODES.FORBIDDEN).toBe(40300);
  });

  it('新码没有撞号', () => {
    const codes = Object.values(ERROR_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
