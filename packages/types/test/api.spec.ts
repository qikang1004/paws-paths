import { ERROR_CODES, ERROR_MESSAGES, messageForCode } from '../src/api';

describe('错误码表', () => {
  it('成功码固定为 0', () => {
    expect(ERROR_CODES.OK).toBe(0);
  });

  it('每个非成功错误码都有中文文案', () => {
    const codes = Object.values(ERROR_CODES).filter((c) => c !== ERROR_CODES.OK);
    for (const code of codes) {
      expect(ERROR_MESSAGES[code]).toBeTruthy();
    }
  });

  it('服务端文案优先于本地文案', () => {
    expect(messageForCode(ERROR_CODES.VALIDATION_FAILED, '犬证编号格式不正确')).toBe(
      '犬证编号格式不正确',
    );
  });

  it('服务端没给文案时回落到本地表', () => {
    expect(messageForCode(ERROR_CODES.UNAUTHORIZED)).toBe('登录已过期，请重试');
  });

  it('未知错误码回落到兜底文案', () => {
    expect(messageForCode(99999)).toBe('服务异常，请稍后再试');
  });

  describe('阶段 2 新增错误码', () => {
    it('关注自己的宠物有专门错误码', () => {
      expect(ERROR_CODES.FOLLOW_SELF).toBe(42203);
    });

    it('内容安全接口不可用有专门错误码（区别于普通微信上游故障）', () => {
      expect(ERROR_CODES.UPSTREAM_WECHAT_SECURITY).toBe(50203);
    });

    it('内容被审核驳回复用既有 AUDIT_REJECTED，不新造错误码', () => {
      expect(ERROR_CODES.AUDIT_REJECTED).toBe(42201);
      // 42202 已被 LOCATION_REQUIRED 占用，新码从 42203 起
      expect(ERROR_CODES.LOCATION_REQUIRED).toBe(42202);
    });

    it('错误码全表无重复值', () => {
      const values = Object.values(ERROR_CODES);
      expect(new Set(values).size).toBe(values.length);
    });
  });
});
