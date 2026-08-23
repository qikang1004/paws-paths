import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { debounce } from '../utils/debounce';
import {
  CATEGORY_OPTIONS,
  buildVenueView,
} from '../pages/venue-list/venue-list-model';
import type { Venue } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const venue = (over: Partial<Venue> = {}): Venue => ({
  poiId: 'v-1',
  name: '爱心宠物医院',
  address: '朝阳区某路 1 号',
  category: 'hospital',
  categoryLabel: '宠物医院',
  distanceMeters: 1200,
  rating: 4.8,
  avgPrice: 120,
  tags: ['24小时', '可急诊'],
  coverUrl: 'https://picsum.photos/id/1/600/400',
  isFavorite: false,
  lat: 39.9042,
  lng: 116.4074,
  ...over,
});

describe('buildVenueView', () => {
  it('评分与人均都有时给出文案', () => {
    const view = buildVenueView(venue());
    expect(view.showRating).toBe(true);
    expect(view.ratingText).toBe('★ 4.8');
    expect(view.showPrice).toBe(true);
    expect(view.priceText).toBe('人均 ¥120');
    expect(view.distanceText).toBe('1.2km');
  });

  it('extras 缺失时评分行不渲染、文案为空', () => {
    const view = buildVenueView(venue({ rating: null }));
    expect(view.showRating).toBe(false);
    expect(view.ratingText).toBe('');
  });

  it('人均缺失时价格行不渲染', () => {
    const view = buildVenueView(venue({ avgPrice: null }));
    expect(view.showPrice).toBe(false);
    expect(view.priceText).toBe('');
  });

  it('标签为空时退回类目标签，卡片不留空标签区', () => {
    expect(buildVenueView(venue({ tags: [] })).tags).toEqual(['宠物医院']);
    expect(buildVenueView(venue()).tags).toEqual(['24小时', '可急诊']);
  });

  it('没有定位时不显示距离', () => {
    expect(buildVenueView(venue({ distanceMeters: null })).distanceText).toBe('');
  });

  it('评分为 0 视为无评分，不显示 ★ 0', () => {
    const view = buildVenueView(venue({ rating: 0 }));
    expect(view.showRating).toBe(false);
  });

  it('保留 poiId 与坐标，供跳转与导航使用', () => {
    const view = buildVenueView(venue());
    expect(view.poiId).toBe('v-1');
    expect(view.lat).toBe(39.9042);
    expect(view.lng).toBe(116.4074);
  });
});

describe('CATEGORY_OPTIONS', () => {
  it('全部在前，六个类目与服务端枚举对齐', () => {
    expect(CATEGORY_OPTIONS[0]).toEqual({ value: 'all', label: '全部' });
    expect(CATEGORY_OPTIONS.map((o) => o.value)).toEqual([
      'all',
      'hospital',
      'shop',
      'grooming',
      'park',
      'cafe',
    ]);
  });
});

describe('debounce', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('连续输入只在停手后发一次，用最后一次的参数', () => {
    const calls: string[] = [];
    const run = debounce((v: string) => calls.push(v), 300);
    run('宠');
    run('宠物');
    run('宠物医');
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(299);
    expect(calls).toEqual([]);
    jest.advanceTimersByTime(1);
    expect(calls).toEqual(['宠物医']);
  });

  it('间隔超过等待时间的两次输入各发一次', () => {
    const calls: string[] = [];
    const run = debounce((v: string) => calls.push(v), 300);
    run('a');
    jest.advanceTimersByTime(300);
    run('b');
    jest.advanceTimersByTime(300);
    expect(calls).toEqual(['a', 'b']);
  });
});

describe('周边列表页配置与结构', () => {
  it('json 声明 venue-card / empty-state 组件', () => {
    const json = JSON.parse(read('pages/venue-list/index.json')) as {
      navigationBarTitleText?: string;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('周边');
    const used = json.usingComponents ?? {};
    expect(used['venue-card']).toBe('/components/venue-card/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['filter-chips']).toBe('/components/filter-chips/index');
  });

  it('wxml 有搜索框、清空按钮、类目筛选与列表', () => {
    const wxml = read('pages/venue-list/index.wxml');
    expect(wxml).toContain('bindinput="onKeywordInput"');
    expect(wxml).toContain('bindtap="onClearKeyword"');
    expect(wxml).toContain('<venue-card');
    expect(wxml).toContain('bind:tap="onVenueTap"');
    expect(wxml).toContain('<empty-state');
  });

  it('页面 ts 走 store 定位、防抖搜索、跳分包详情', () => {
    const ts = read('pages/venue-list/index.ts');
    expect(ts).toContain('locationStore');
    expect(ts).toContain('fetchVenues');
    expect(ts).toContain('debounce');
    // 场所详情是分包页（app.json: subPackage root packages/venue）。
    expect(ts).toContain('/packages/venue/pages/detail/index?poiId=');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read('pages/venue-list/index.wxss');
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
