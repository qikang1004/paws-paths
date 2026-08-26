import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { breedsForSpecies } from '../shared/filter';
import {
  buildFeedItem,
  mergePage,
  shouldLoadMore,
  type FeedItem,
} from '../pages/plaza/plaza-model';
import { formatPetAge, type PetSummary } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const BASE = 'https://api.example.com';

const pet = (over: Partial<PetSummary> = {}): PetSummary => ({
  id: 'p-1',
  name: '布丁',
  species: 'cat',
  breed: '布偶',
  gender: 'female',
  birthDate: '2024-02-16',
  coverUrl: 'https://picsum.photos/id/237/600/800',
  coverWidth: 600,
  coverHeight: 800,
  personalityTags: ['粘人', '爱睡'],
  distanceMeters: 999,
  ownerNickname: '小鱼',
  ownerAvatarUrl: null,
  ownerVerified: true,
  isFollowing: false,
  ...over,
});

describe('buildFeedItem', () => {
  it('把接口字段翻译成卡片展示字段', () => {
    const item = buildFeedItem(pet(), new Date('2026-08-16T00:00:00Z'));
    expect(item.id).toBe('p-1');
    expect(item.distanceText).toBe('999m');
    expect(item.genderText).toBe('雌');
    expect(item.ageText).toBe(formatExpectedAge());
    expect(item.width).toBe(600);
    expect(item.height).toBe(800);
  });

  it('没有定位时不显示距离，而不是显示 0m', () => {
    const item = buildFeedItem(pet({ distanceMeters: null }));
    expect(item.distanceText).toBe('');
  });

  it('距离超过 1km 走 km 文案', () => {
    expect(buildFeedItem(pet({ distanceMeters: 2500 })).distanceText).toBe('2.5km');
  });

  it('性别未知不编造文案', () => {
    expect(buildFeedItem(pet({ gender: 'unknown' })).genderText).toBe('');
    expect(buildFeedItem(pet({ gender: 'male' })).genderText).toBe('雄');
  });

  it('封面宽高缺失时不产出会炸分列的比例', () => {
    const item = buildFeedItem(pet({ coverWidth: 0, coverHeight: 0 }));
    expect(item.width).toBeGreaterThan(0);
    expect(item.height).toBeGreaterThan(0);
  });

  it('相对路径的封面与头像补成绝对地址（服务端存的就是相对路径）', () => {
    const item = buildFeedItem(
      pet({ coverUrl: '/uploads/u-1/a.jpg', ownerAvatarUrl: '/uploads/u-1/avatar.jpg' }),
      undefined,
      BASE,
    );
    expect(item.coverUrl).toBe(`${BASE}/uploads/u-1/a.jpg`);
    expect(item.ownerAvatarUrl).toBe(`${BASE}/uploads/u-1/avatar.jpg`);
  });

  it('已是绝对地址的原样用；没有封面/头像回空串让模板整块不渲染', () => {
    const item = buildFeedItem(pet(), undefined, BASE);
    expect(item.coverUrl).toBe('https://picsum.photos/id/237/600/800');
    expect(item.ownerAvatarUrl).toBe('');
    expect(buildFeedItem(pet({ coverUrl: '' }), undefined, BASE).coverUrl).toBe('');
  });
});

const feed = (id: string): FeedItem => buildFeedItem(pet({ id }));

describe('mergePage', () => {
  it('第一页直接替换，后续页追加', () => {
    const first = mergePage([], [feed('a'), feed('b')], { page: 1, hasMore: true });
    expect(first.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(first.page).toBe(1);
    expect(first.hasMore).toBe(true);

    const second = mergePage(first.items, [feed('c')], { page: 2, hasMore: false });
    expect(second.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(second.page).toBe(2);
    expect(second.hasMore).toBe(false);
  });

  it('服务端重复返回同一条时不产生重复 key', () => {
    const merged = mergePage([feed('a')], [feed('a'), feed('b')], { page: 2, hasMore: false });
    expect(merged.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('空结果不清掉已有列表，只落 hasMore', () => {
    const merged = mergePage([feed('a')], [], { page: 2, hasMore: false });
    expect(merged.items.map((i) => i.id)).toEqual(['a']);
    expect(merged.hasMore).toBe(false);
  });
});

describe('shouldLoadMore', () => {
  it('还有下一页且当前空闲才继续拉', () => {
    expect(shouldLoadMore(true, false)).toBe(true);
    expect(shouldLoadMore(false, true)).toBe(false);
    expect(shouldLoadMore(true, true)).toBe(false);
    expect(shouldLoadMore(false, false)).toBe(false);
  });
});

describe('品种联动', () => {
  it('all / other 没有可枚举品种，页面据此隐藏第二层', () => {
    expect(breedsForSpecies('all')).toEqual([]);
    expect(breedsForSpecies('other')).toEqual([]);
    expect(breedsForSpecies('cat').length).toBeGreaterThan(0);
  });
});

describe('广场页配置与结构', () => {
  it('json 声明四个组件、下拉刷新与触底距离', () => {
    const json = JSON.parse(read('pages/plaza/index.json')) as {
      navigationBarTitleText?: string;
      enablePullDownRefresh?: boolean;
      onReachBottomDistance?: number;
      usingComponents?: Record<string, string>;
    };
    expect(json.enablePullDownRefresh).toBe(true);
    expect(json.onReachBottomDistance).toBe(200);
    const used = json.usingComponents ?? {};
    expect(used['wf-list']).toBe('/components/wf-list/index');
    expect(used['filter-chips']).toBe('/components/filter-chips/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['sq-button']).toBe('/components/sq-button/index');
  });

  it('wxml 接上筛选、瀑布流与空态', () => {
    const wxml = read('pages/plaza/index.wxml');
    expect(wxml).toContain('bind:change="onFilterChange"');
    expect(wxml).toContain('bind:item-tap="onPetTap"');
    expect(wxml).toContain('itemTemplate="pet-card-tpl"');
    expect(wxml).toContain('<empty-state');
    // 空态只在「加载完了确实没有」时出现，加载中不闪空态。
    expect(wxml).toContain('wx:elif="{{!loading}}"');
  });

  it('页面 ts 只做绑定：定位经 store，翻页经纯函数', () => {
    const ts = read('pages/plaza/index.ts');
    expect(ts).toContain('locationStore');
    expect(ts).toContain('fetchPets');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('onReachBottom');
    expect(ts).toContain('onPullDownRefresh');
    expect(ts).toContain('stopPullDownRefresh');
    expect(ts).toContain("navigateTo");
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read('pages/plaza/index.wxss');
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});

/** 年龄口径归 formatPetAge 一处，测试不另写一套算法，只确认页面用了它。 */
function formatExpectedAge(): string {
  return formatPetAge('2024-02-16', new Date('2026-08-16T00:00:00Z')).text;
}
