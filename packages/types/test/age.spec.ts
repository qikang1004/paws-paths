import { formatPetAge } from '../src/age';

const NOW = new Date('2026-08-17T00:00:00Z');

describe('formatPetAge', () => {
  it('满 11 个月显示月龄', () => {
    expect(formatPetAge('2025-09-17', NOW).text).toBe('11个月');
  });

  it('满 12 个月切换为岁', () => {
    expect(formatPetAge('2025-08-17', NOW)).toEqual({ value: 1, unit: 'year', text: '1岁' });
  });

  it('差一天不满 12 个月仍显示月龄', () => {
    expect(formatPetAge('2025-08-18', NOW).text).toBe('11个月');
  });

  it('原型上的 8 个月与 2 岁都能复现', () => {
    expect(formatPetAge('2025-12-17', NOW).text).toBe('8个月');
    expect(formatPetAge('2024-08-17', NOW).text).toBe('2岁');
  });

  it('岁数向下取整，不四舍五入', () => {
    expect(formatPetAge('2024-10-17', NOW).text).toBe('1岁');
  });

  it('出生日期在未来时归零，不出现负数', () => {
    expect(formatPetAge('2027-01-01', NOW)).toEqual({ value: 0, unit: 'month', text: '0个月' });
  });
});
