import { formatDistance, formatPetAge } from '../utils/format';

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
