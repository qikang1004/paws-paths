import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/following';

/**
 * 关注列表没有自己的数据装配：卡片投影 `buildFeedItem` 与翻页 `mergePage`
 * 都是四个列表页共用的（`utils/pet-card-view.ts` / `utils/list-paging.ts`，
 * 各自已有测试）。所以这里只钉住「页面确实接的是那两个」和 markup。
 */
describe('关注列表页配置与结构', () => {
  /**
   * 下拉刷新与触底都搬到了 scroll-view 上（Skyline 不提供全局滚动，页面级的
   * `enablePullDownRefresh` / `onReachBottomDistance` 没有载体），所以这里反过来
   * 钉住它们不在 json 里——留着会在 WebView 回退路径上显示一个永不收回的刷新圈。
   */
  it('json 声明瀑布流与空态，不再声明页面级下拉刷新与触底', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      enablePullDownRefresh?: boolean;
      onReachBottomDistance?: number;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('我的关注');
    expect(json.enablePullDownRefresh).toBeUndefined();
    expect(json.onReachBottomDistance).toBeUndefined();
    const used = json.usingComponents ?? {};
    expect(used['wf-list']).toBe('/components/wf-list/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
  });

  it('wxml 复用 pet-card-tpl 瀑布流，空态只在加载完确实没有时出现', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('<wf-list');
    expect(wxml).toContain('itemTemplate="pet-card-tpl"');
    expect(wxml).toContain('bind:item-tap="onPetTap"');
    expect(wxml).toContain('<empty-state');
    expect(wxml).toContain('wx:elif="{{!loading}}"');
  });

  it('wxml 用铺满的 scroll-view 承载滚动，刷新与触底挂在它身上', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('<scroll-view');
    expect(wxml).toContain('class="page-scroll"');
    expect(wxml).toContain('scroll-y="{{true}}"');
    expect(wxml).toContain('refresher-enabled="{{true}}"');
    expect(wxml).toContain('refresher-triggered="{{refreshing}}"');
    expect(wxml).toContain('bindrefresherrefresh="onRefresh"');
    expect(wxml).toContain('bindscrolltolower="onLoadMore"');
  });

  it('页面 ts 经 api 层取数、翻页用纯函数、点卡片进详情', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchFollowing');
    expect(ts).toContain('buildFeedItem');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toContain('onLoadMore');
    expect(ts).toContain('onRefresh');
    // 刷新态是受控位：取数失败也得复位，否则刷新圈不收。所以复位必须在 finally 里。
    expect(ts).toMatch(/finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/);
    expect(ts).toContain('/pages/pet-detail/index?id=');
    expect(ts).not.toContain('wx.request');
  });

  it('从详情页返回时重取第一页——那边可能刚取关', () => {
    expect(read(`${DIR}/index.ts`)).toMatch(/onShow\(\)[\s\S]{0,200}loadPage\(1\)/);
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
