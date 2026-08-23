import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import {
  canNavigate,
  detailView,
} from '../packages/venue/pages/detail/venue-detail-model';
import type { Venue } from '../shared/types/index';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const DIR = 'packages/venue/pages/detail';
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
  tags: ['24小时'],
  coverUrl: 'https://picsum.photos/id/1/600/400',
  isFavorite: false,
  lat: 39.9042,
  lng: 116.4074,
  ...over,
});

describe('canNavigate', () => {
  it('两个坐标都有才能导航', () => {
    expect(canNavigate(venue())).toBe(true);
    expect(canNavigate(venue({ lat: null }))).toBe(false);
    expect(canNavigate(venue({ lng: null }))).toBe(false);
    expect(canNavigate(venue({ lat: null, lng: null }))).toBe(false);
  });

  it('venue 缺失时不导航', () => {
    expect(canNavigate(null)).toBe(false);
  });
});

describe('detailView', () => {
  it('复用卡片口径的降级字段', () => {
    const view = detailView(venue());
    expect(view.ratingText).toBe('★ 4.8');
    expect(view.priceText).toBe('人均 ¥120');
    expect(view.showRating).toBe(true);
  });

  it('extras 缺失时评分与人均行都不渲染', () => {
    const view = detailView(venue({ rating: null, avgPrice: null }));
    expect(view.showRating).toBe(false);
    expect(view.showPrice).toBe(false);
  });

  it('收藏入口恒在，登录与否交给 api 层', () => {
    expect(detailView(venue()).showFavorite).toBe(true);
    expect(detailView(venue({ isFavorite: true })).showFavorite).toBe(true);
  });

  it('有坐标才给导航入口', () => {
    expect(detailView(venue()).showNavigation).toBe(true);
    expect(detailView(venue({ lat: null, lng: null })).showNavigation).toBe(false);
  });

  it('标签为空退回类目标签', () => {
    expect(detailView(venue({ tags: [] })).tags).toEqual(['宠物医院']);
  });
});

describe('openMapNavigation', () => {
  it('封装 wx.openLocation，页面不自己拼参数', () => {
    const src = read('utils/navigation.ts');
    expect(src).toContain('openLocation');
    expect(src).toContain('latitude');
    expect(src).toContain('longitude');
  });
});

describe('场所详情页配置与结构', () => {
  it('json 声明所需组件', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      usingComponents?: Record<string, string>;
    };
    const used = json.usingComponents ?? {};
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['sq-button']).toBe('/components/sq-button/index');
  });

  it('wxml 有降级行、收藏与导航按钮、可复制地址', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:if="{{view.showRating}}"');
    expect(wxml).toContain('wx:if="{{view.showPrice}}"');
    expect(wxml).toContain('wx:if="{{view.showNavigation}}"');
    expect(wxml).toContain('bindtap="onToggleFavorite"');
    expect(wxml).toContain('bindtap="onNavigate"');
    expect(wxml).toContain('bindtap="onCopyAddress"');
    expect(wxml).toContain('selectable');
    expect(wxml).toContain('<empty-state');
  });

  it('收藏按钮的样式跟着收藏状态走', () => {
    expect(read(`${DIR}/index.wxml`)).toContain("{{favorite ? 'plain' : 'primary'}}");
  });

  it('页面 ts 接上接口、剪贴板与导航封装', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchVenueDetail');
    expect(ts).toContain('addFavorite');
    expect(ts).toContain('removeFavorite');
    expect(ts).toContain('openMapNavigation');
    expect(ts).toContain('setClipboardData');
    // 分包页回主包取公共代码，路径要多退两级。
    expect(ts).toContain('../../../../utils/navigation');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
