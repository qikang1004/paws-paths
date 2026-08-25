import { formatDistance, formatPetAge, formatPostTime } from '../utils/format';

describe('formatDistance', () => {
  it('null → 空串（未授权定位时不显示距离）', () => {
    expect(formatDistance(null)).toBe('');
  });

  it('不足 1 公里按米取整', () => {
    expect(formatDistance(0)).toBe('0m');
    expect(formatDistance(999)).toBe('999m');
    expect(formatDistance(342.6)).toBe('343m');
  });

  it('满 1 公里按公里保留一位小数', () => {
    expect(formatDistance(1000)).toBe('1.0km');
    expect(formatDistance(1530)).toBe('1.5km');
  });
});

describe('formatPetAge 复用 shared/types 的既有实现', () => {
  it('不足 12 个月显示月龄', () => {
    expect(formatPetAge('2026-04-16', new Date('2026-08-16T00:00:00Z')).text).toBe('4个月');
  });

  it('满 12 个月显示岁数', () => {
    expect(formatPetAge('2024-05-01', new Date('2026-08-16T00:00:00Z')).text).toBe('2岁');
  });
});

/**
 * 动态时间。两端都用**本地日历**构造，所以断言不随运行环境的时区变色 ——
 * 直接写 `'2026-03-05T12:00:00Z'` 那种字面量在 UTC+14 的机器上会滑到次日。
 */
const at = (y: number, m: number, d: number, h = 12, min = 0): Date =>
  new Date(y, m - 1, d, h, min);

describe('formatPostTime', () => {
  const now = at(2026, 8, 25, 12).getTime();

  it('一分钟内显示「刚刚」，不显示「0分钟前」', () => {
    expect(formatPostTime(at(2026, 8, 25, 12).toISOString(), now)).toBe('刚刚');
    // 差 30 秒还在「刚刚」里；`at` 只到分钟，所以这里直接减毫秒。
    expect(formatPostTime(new Date(now - 30_000).toISOString(), now)).toBe('刚刚');
  });

  it('整一分钟是边界：60 秒前算「1分钟前」，不是「刚刚」', () => {
    expect(formatPostTime(at(2026, 8, 25, 11, 59).toISOString(), now)).toBe('1分钟前');
  });

  it('一小时内按分钟', () => {
    expect(formatPostTime(at(2026, 8, 25, 11, 30).toISOString(), now)).toBe('30分钟前');
    expect(formatPostTime(at(2026, 8, 25, 11, 1).toISOString(), now)).toBe('59分钟前');
  });

  it('一天内按小时', () => {
    expect(formatPostTime(at(2026, 8, 25, 11).toISOString(), now)).toBe('1小时前');
    expect(formatPostTime(at(2026, 8, 24, 13).toISOString(), now)).toBe('23小时前');
  });

  it('一周内按天', () => {
    expect(formatPostTime(at(2026, 8, 24, 12).toISOString(), now)).toBe('1天前');
    expect(formatPostTime(at(2026, 8, 19, 12).toISOString(), now)).toBe('6天前');
  });

  it('超过一周显示日期，同年不带年份', () => {
    expect(formatPostTime(at(2026, 8, 18, 12).toISOString(), now)).toBe('8月18日');
    expect(formatPostTime(at(2026, 3, 5, 12).toISOString(), now)).toBe('3月5日');
  });

  it('跨年带上年份', () => {
    expect(formatPostTime(at(2025, 12, 31, 12).toISOString(), now)).toBe('2025年12月31日');
  });

  // 服务端时钟比客户端快一点是常态（本机时间没对齐时能差出几分钟）。
  // 负的时间差不能算成「-3分钟前」。
  it('未来时间按「刚刚」处理', () => {
    expect(formatPostTime(at(2026, 8, 25, 12, 3).toISOString(), now)).toBe('刚刚');
  });

  it('时间串解析不出来时返回空串，让页面隐藏那一行', () => {
    expect(formatPostTime('', now)).toBe('');
    expect(formatPostTime('not-a-date', now)).toBe('');
  });
});
