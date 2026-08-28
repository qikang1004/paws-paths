import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/history';

/**
 * 行装配与按天分段都在 `utils/mixed-list-view.ts`（已有测试），
 * 这里钉住页面接的是它们，以及分段是从**合并后的整份列表**算的 ——
 * 每页各算一份的话，跨页的同一天会分裂成两个「今天」。
 */
describe('浏览历史页配置与结构', () => {
  /**
   * 下拉刷新与触底都搬到了 scroll-view 上（Skyline 不提供全局滚动，页面级的
   * `enablePullDownRefresh` / `onReachBottomDistance` 没有载体），所以这里反过来
   * 钉住它们不在 json 里——留着会在 WebView 回退路径上显示一个永不收回的刷新圈。
   */
  it('json 声明空态，不再声明页面级下拉刷新与触底', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      enablePullDownRefresh?: boolean;
      onReachBottomDistance?: number;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('浏览历史');
    expect(json.enablePullDownRefresh).toBeUndefined();
    expect(json.onReachBottomDistance).toBeUndefined();
    const used = json.usingComponents ?? {};
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['wf-icon']).toBe('/components/wf-icon/index');
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

  it('wxml 外层按天分段、内层一行一条', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:for="{{sections}}"');
    expect(wxml).toContain('wx:for-item="section"');
    expect(wxml).toContain('{{section.label}}');
    expect(wxml).toContain('wx:for="{{section.items}}"');
    expect(wxml).toContain('wx:key="id"');
    expect(wxml).toContain('bindtap="onRowTap"');
    expect(wxml).toContain('{{item.typeLabel}}');
    expect(wxml).toContain('wx:if="{{item.coverUrl}}"');
    expect(wxml).toContain('<empty-state');
    expect(wxml).toContain('wx:elif="{{!loading}}"');
  });

  it('页面 ts 经 api 层取数，分段从合并后的整份列表算', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchHistory');
    expect(ts).toContain('buildHistoryRow');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toMatch(/groupByDay\(merged\.items\)/);
    expect(ts).toContain('onLoadMore');
    expect(ts).toContain('onRefresh');
    // 刷新态是受控位：取数失败也得复位，否则刷新圈不收。所以复位必须在 finally 里。
    expect(ts).toMatch(/finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/);
    expect(ts).not.toContain('wx.request');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
