import { API_BASE_URL } from '../config';
import { formatPostTime } from './format';
import { resolveImageUrl } from './image-url';
import type { FavoriteItemDto, ViewHistoryItemDto } from '../shared/types/index';

/**
 * 「混排缩略图行」——「我的收藏」与「浏览历史」两个页面共用的行装配。
 *
 * 服务端刻意让 `FavoriteItemDto` 与 `ViewHistoryItemDto` 只差一个时间字段名
 * （见两者的注释），所以客户端也只该有一份实现：各写一份的话，「宠物点进哪个页面」
 * 「没封面怎么办」这类细节迟早在两个页面上分叉。
 */

export type MixedTargetType = 'pet' | 'venue';

export interface MixedRow {
  /**
   * 列表的 `wx:key`。做成 `pet:p-1` 这种复合键：宠物与场所的 id 各自独立编号，
   * 混排时只用 `targetId` 有撞键的可能，撞了整段列表都会渲染错乱。
   */
  id: string;
  targetType: MixedTargetType;
  targetId: string;
  title: string;
  /** 已补全的封面地址；没有封面时是空串，让 wxml 整块不渲染。 */
  coverUrl: string;
  typeLabel: string;
  timeText: string;
  /** 点进去的路由。宠物在主包，场所在 `packages/venue` 分包。 */
  url: string;
  /** 本地日历的 `YYYY-MM-DD`，浏览历史按它分段。 */
  dayKey: string;
  dayLabel: string;
}

export interface MixedRowOptions {
  /** 图片地址的 base。默认接口 base，测试注入固定值。 */
  baseUrl?: string;
  /** 相对时间与「今天/昨天」的基准。默认当前时刻，测试注入固定值。 */
  now?: number;
}

const TYPE_LABEL: Readonly<Record<MixedTargetType, string>> = {
  pet: '宠物',
  venue: '场所',
};

/**
 * 目标路由。写成查表而不是 if：将来加第三种收藏目标时，漏了哪一格是编译错误，
 * 而不是在页面上点出一个跳不动的行。
 */
const TARGET_URL: Readonly<Record<MixedTargetType, (id: string) => string>> = {
  pet: (id) => `/pages/pet-detail/index?id=${id}`,
  venue: (id) => `/packages/venue/pages/detail/index?poiId=${id}`,
};

/** 本地日历的 `YYYY-MM-DD`。用 `getFullYear` 一族而不是 `toISOString`，跟着用户手机的时区走。 */
function dayKeyOf(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 分段标题。近两天说「今天/昨天」，再远说日期 —— 跨年才带年份。 */
function dayLabelOf(date: Date, now: Date): string {
  const key = dayKeyOf(date);
  if (key === dayKeyOf(now)) return '今天';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKeyOf(yesterday)) return '昨天';
  const label = `${date.getMonth() + 1}月${date.getDate()}日`;
  return date.getFullYear() === now.getFullYear() ? label : `${date.getFullYear()}年${label}`;
}

interface MixedInput {
  targetType: MixedTargetType;
  targetId: string;
  title: string;
  coverUrl: string | null;
  at: string;
}

function buildRow(input: MixedInput, opts: MixedRowOptions): MixedRow {
  const now = opts.now ?? Date.now();
  const date = new Date(input.at);
  // 解不出来的时间按「现在」分段：宁可分错一格，也不要在页面上留下 NaN 标题。
  const safeDate = Number.isNaN(date.getTime()) ? new Date(now) : date;
  return {
    id: `${input.targetType}:${input.targetId}`,
    targetType: input.targetType,
    targetId: input.targetId,
    title: input.title,
    coverUrl: resolveImageUrl(input.coverUrl, opts.baseUrl ?? API_BASE_URL),
    typeLabel: TYPE_LABEL[input.targetType],
    timeText: formatPostTime(input.at, now),
    url: TARGET_URL[input.targetType](input.targetId),
    dayKey: dayKeyOf(safeDate),
    dayLabel: dayLabelOf(safeDate, new Date(now)),
  };
}

export function buildFavoriteRow(item: FavoriteItemDto, opts: MixedRowOptions = {}): MixedRow {
  return buildRow({ ...item, at: item.favoritedAt }, opts);
}

export function buildHistoryRow(item: ViewHistoryItemDto, opts: MixedRowOptions = {}): MixedRow {
  return buildRow({ ...item, at: item.viewedAt }, opts);
}

export interface DaySection {
  key: string;
  label: string;
  items: MixedRow[];
}

/**
 * 按天分段。**只并相邻的同一天**，不重排 —— 服务端已按时间倒序给了，
 * 客户端再排一次等于第二份排序口径。分页追加进来的下一页也因此天然接在后面。
 */
export function groupByDay(rows: MixedRow[]): DaySection[] {
  const sections: DaySection[] = [];
  for (const row of rows) {
    const last = sections[sections.length - 1];
    if (last && last.key === row.dayKey) {
      last.items.push(row);
      continue;
    }
    sections.push({ key: row.dayKey, label: row.dayLabel, items: [row] });
  }
  return sections;
}
