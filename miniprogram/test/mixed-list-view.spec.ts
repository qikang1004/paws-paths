import type { FavoriteItemDto, ViewHistoryItemDto } from '../shared/types/index';
import { buildFavoriteRow, buildHistoryRow, groupByDay } from '../utils/mixed-list-view';

const BASE = 'https://api.example.com';

/** 用本地日历零件造时间，避免测试跟着运行机器的时区漂。 */
const at = (y: number, m: number, d: number, h = 12, min = 0): Date =>
  new Date(y, m - 1, d, h, min);

const NOW = at(2026, 8, 26, 10).getTime();

const favorite = (over: Partial<FavoriteItemDto> = {}): FavoriteItemDto => ({
  targetType: 'pet',
  targetId: 'p-1',
  title: '大黄',
  coverUrl: '/uploads/u-1/a.jpg',
  favoritedAt: at(2026, 8, 26, 9).toISOString(),
  ...over,
});

const history = (over: Partial<ViewHistoryItemDto> = {}): ViewHistoryItemDto => ({
  targetType: 'venue',
  targetId: 'v-9',
  title: '爱心宠物医院',
  coverUrl: 'https://picsum.photos/id/1/600/400',
  viewedAt: at(2026, 8, 26, 8).toISOString(),
  ...over,
});

/**
 * 收藏与浏览历史是同一种「混排缩略图行」：服务端刻意让两个 DTO 只差时间字段名
 * （见 `FavoriteItemDto` 的注释），所以客户端也只该有一份行装配实现。
 */
describe('buildFavoriteRow / buildHistoryRow', () => {
  it('宠物行点进主包详情页', () => {
    const row = buildFavoriteRow(favorite(), { baseUrl: BASE, now: NOW });
    expect(row.url).toBe('/pages/pet-detail/index?id=p-1');
    expect(row.typeLabel).toBe('宠物');
  });

  it('场所行点进 venue 分包详情页', () => {
    const row = buildHistoryRow(history(), { baseUrl: BASE, now: NOW });
    expect(row.url).toBe('/packages/venue/pages/detail/index?poiId=v-9');
    expect(row.typeLabel).toBe('场所');
  });

  it('wx:key 用「类型:id」复合键 —— 宠物与场所的 id 各自独立，会撞', () => {
    const pet = buildFavoriteRow(favorite({ targetId: 'x' }), { baseUrl: BASE, now: NOW });
    const venue = buildFavoriteRow(favorite({ targetType: 'venue', targetId: 'x' }), {
      baseUrl: BASE,
      now: NOW,
    });
    expect(pet.id).toBe('pet:x');
    expect(venue.id).toBe('venue:x');
    expect(pet.id).not.toBe(venue.id);
  });

  it('相对路径的封面补成绝对地址，绝对地址原样留着', () => {
    expect(buildFavoriteRow(favorite(), { baseUrl: BASE, now: NOW }).coverUrl).toBe(
      `${BASE}/uploads/u-1/a.jpg`,
    );
    expect(buildHistoryRow(history(), { baseUrl: BASE, now: NOW }).coverUrl).toBe(
      'https://picsum.photos/id/1/600/400',
    );
  });

  it('没有封面时回空串，让 wxml 整块不渲染', () => {
    expect(buildFavoriteRow(favorite({ coverUrl: null }), { baseUrl: BASE, now: NOW }).coverUrl).toBe(
      '',
    );
  });

  it('时间文案两边同一口径（formatPostTime）', () => {
    expect(buildFavoriteRow(favorite(), { baseUrl: BASE, now: NOW }).timeText).toBe('1小时前');
    expect(buildHistoryRow(history(), { baseUrl: BASE, now: NOW }).timeText).toBe('2小时前');
  });

  it('按本地日历给出分组键与标签：今天 / 昨天 / 更早的日期', () => {
    const today = buildHistoryRow(history(), { baseUrl: BASE, now: NOW });
    expect(today.dayKey).toBe('2026-08-26');
    expect(today.dayLabel).toBe('今天');

    const yesterday = buildHistoryRow(
      history({ viewedAt: at(2026, 8, 25, 23).toISOString() }),
      { baseUrl: BASE, now: NOW },
    );
    expect(yesterday.dayKey).toBe('2026-08-25');
    expect(yesterday.dayLabel).toBe('昨天');

    const older = buildHistoryRow(history({ viewedAt: at(2026, 8, 3, 20).toISOString() }), {
      baseUrl: BASE,
      now: NOW,
    });
    expect(older.dayKey).toBe('2026-08-03');
    expect(older.dayLabel).toBe('8月3日');

    const lastYear = buildHistoryRow(history({ viewedAt: at(2025, 12, 31, 20).toISOString() }), {
      baseUrl: BASE,
      now: NOW,
    });
    expect(lastYear.dayLabel).toBe('2025年12月31日');
  });
});

describe('groupByDay', () => {
  const row = (day: number, id: string) =>
    buildHistoryRow(history({ targetId: id, viewedAt: at(2026, 8, day, 12).toISOString() }), {
      baseUrl: BASE,
      now: NOW,
    });

  it('相邻同一天并成一段，段内与段间都保持服务端给的顺序', () => {
    const sections = groupByDay([row(26, 'a'), row(26, 'b'), row(25, 'c')]);
    expect(sections.map((s) => s.key)).toEqual(['2026-08-26', '2026-08-25']);
    expect(sections[0].label).toBe('今天');
    expect(sections[0].items.map((i) => i.targetId)).toEqual(['a', 'b']);
    expect(sections[1].items.map((i) => i.targetId)).toEqual(['c']);
  });

  it('空列表得到空分组，页面据此显示空态', () => {
    expect(groupByDay([])).toEqual([]);
  });
});
