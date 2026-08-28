import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { dropById } from '../utils/list-paging';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/favorites';

/** 取消收藏后那一行要当场消失，不能靠重拉一整页（翻页位置会跳回顶部）。 */
describe('dropById', () => {
  it('摘掉指定 id，其余顺序不动', () => {
    const rows = [{ id: 'pet:a' }, { id: 'venue:a' }, { id: 'pet:b' }];
    expect(dropById(rows, 'venue:a').map((r) => r.id)).toEqual(['pet:a', 'pet:b']);
  });

  it('id 不在列表里就原样返回，并且是一个新数组（setData 认引用）', () => {
    const rows = [{ id: 'pet:a' }];
    const next = dropById(rows, 'pet:zzz');
    expect(next.map((r) => r.id)).toEqual(['pet:a']);
    expect(next).not.toBe(rows);
  });
});

/**
 * 行装配（宠物/场所混排、封面补全、复合键）在 `utils/mixed-list-view.ts` 已有测试，
 * 这里只钉住页面确实接的是它，以及两类目标各自调对的取消收藏接口。
 */
describe('收藏列表页配置与结构', () => {
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
    expect(json.navigationBarTitleText).toBe('我的收藏');
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

  it('wxml 一行一条：缩略图、标题、类型、时间，右侧可取消收藏', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:for="{{rows}}"');
    expect(wxml).toContain('wx:key="id"');
    expect(wxml).toContain('bindtap="onRowTap"');
    // 取消按钮用 catchtap：冒泡到整行会在取消的同时把人跳进详情页。
    expect(wxml).toContain('catchtap="onUnfavorite"');
    expect(wxml).toContain('{{item.typeLabel}}');
    expect(wxml).toContain('{{item.timeText}}');
    // 没封面的目标（场所常见）不留碎图。
    expect(wxml).toContain('wx:if="{{item.coverUrl}}"');
    expect(wxml).toContain('<empty-state');
    expect(wxml).toContain('wx:elif="{{!loading}}"');
  });

  it('页面 ts 经 api 层取数，行装配复用 buildFavoriteRow', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchFavorites');
    expect(ts).toContain('buildFavoriteRow');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toContain('onLoadMore');
    expect(ts).toContain('onRefresh');
    // 刷新态是受控位：取数失败也得复位，否则刷新圈不收。所以复位必须在 finally 里。
    expect(ts).toMatch(/finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/);
    expect(ts).not.toContain('wx.request');
  });

  it('宠物走 unfavoritePet，场所走 removeFavorite，成功后本地摘行', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('unfavoritePet');
    expect(ts).toContain('removeFavorite');
    expect(ts).toMatch(/targetType === 'pet'/);
    expect(ts).toContain('dropById');
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
