import { parseModerationFilter } from '../src/moderation/moderation.service';
import { ApiException } from '../src/common/api.exception';
import { ERROR_CODES } from '@paws/types';

/**
 * 筛选参数的校验。三个列表端点共用这一个 parser，各自用 `allowed` 声明认哪几维。
 */
describe('parseModerationFilter', () => {
  const ALL = ['targetType', 'reason', 'result', 'action'] as const;

  it('什么都没传时返回空对象 —— 空对象即不筛', () => {
    expect(parseModerationFilter({}, ALL)).toEqual({});
  });

  it('合法值原样带出', () => {
    expect(parseModerationFilter({ targetType: 'post_image', reason: 'porn' }, ALL)).toEqual({
      targetType: 'post_image',
      reason: 'porn',
    });
  });

  /**
   * 空串按「没传」处理：前端把筛选器清空时最自然的写法就是 `?reason=`，
   * 那不该是 422。
   */
  it('空串等于没传', () => {
    expect(parseModerationFilter({ reason: '', targetType: '' }, ALL)).toEqual({});
  });

  /**
   * **非法值是 422，不是静默当没筛。** 后者会让客户端以为筛生效了而实际返回全量，
   * 那种错在界面上表现成「筛选按钮没反应」，极难查。
   */
  it.each([
    ['targetType', 'pet_photo'],
    ['reason', '自由文本'],
    ['result', 'pending'],
    ['action', '删除'],
  ])('%s=%s 非法时抛 422', (key, value) => {
    expect(() => parseModerationFilter({ [key]: value }, ALL)).toThrow(ApiException);
    try {
      parseModerationFilter({ [key]: value }, ALL);
    } catch (err) {
      expect((err as ApiException).code).toBe(ERROR_CODES.VALIDATION_FAILED);
    }
  });

  /**
   * `allowed` 之外的字段**静默忽略**，不报错 —— 客户端可以把同一个筛选器状态
   * 原样发给任一端点（流水页的 `action` 在工单端点上无意义，但不该拒绝整个请求）。
   */
  it('不在 allowed 里的字段被忽略，而不是报错', () => {
    expect(parseModerationFilter({ action: 'report' }, ['targetType', 'reason'])).toEqual({});
  });

  /** 忽略要彻底：连值的合法性都不校验 —— 那个维度在这个端点上压根不存在。 */
  it('被忽略的字段即使值非法也不报错', () => {
    expect(parseModerationFilter({ action: '乱值' }, ['targetType'])).toEqual({});
  });

  it('待办端点认的两维', () => {
    const filter = parseModerationFilter(
      { targetType: 'post', reason: 'spam', result: 'approved' },
      ['targetType', 'reason'],
    );
    // result 不在 allowed 里 —— 待办的 result 恒为空，筛它没有意义。
    expect(filter).toEqual({ targetType: 'post', reason: 'spam' });
  });

  it('流水端点认动作，不认举报原因', () => {
    const filter = parseModerationFilter({ action: 'review_reject', reason: 'spam' }, [
      'targetType',
      'action',
    ]);
    expect(filter).toEqual({ action: 'review_reject' });
  });
});
