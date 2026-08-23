// 年龄口径全应用统一：直接复用 shared/types 的实现，不在页面侧另写一套。
export { formatPetAge } from '../shared/types/index';
export type { PetAge, AgeUnit } from '../shared/types/index';

/**
 * 距离文案。null 表示没有定位授权 —— 返回空串让页面隐藏该行，
 * 而不是显示「0m」误导用户。
 */
export function formatDistance(meters: number | null): string {
  if (meters == null) return '';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}
