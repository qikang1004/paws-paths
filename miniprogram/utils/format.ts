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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 动态发布时间。近的说相对，远的说日期 —— 「1234小时前」没人会去换算。
 *
 * `now` 可注入，测试才能不依赖真实时钟。未来时间按「刚刚」处理：
 * 服务端时钟比客户端快几分钟是常态，不能显示成「-3分钟前」。
 *
 * 日期分支用**本地日历**（`getFullYear` 等），跟着用户手机的时区走。
 */
export function formatPostTime(publishedAt: string, now: number = Date.now()): string {
  const at = new Date(publishedAt);
  const time = at.getTime();
  // 解不出来就回空串，让页面隐藏那一行，而不是显示 NaN。
  if (Number.isNaN(time)) return '';

  const diff = now - time;
  if (diff < MINUTE) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}天前`;

  const date = `${at.getMonth() + 1}月${at.getDate()}日`;
  return at.getFullYear() === new Date(now).getFullYear() ? date : `${at.getFullYear()}年${date}`;
}
