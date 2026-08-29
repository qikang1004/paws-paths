import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';
import { PROFILE_ENTRIES } from '../pages/profile/profile-model';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/feed';

/**
 * 关注流页面（阶段 3 Task 10）。
 *
 * `GET /me/feed` 不吃 `petId`（跨宠物混排），所以这页比「我的动态」简单一层 ——
 * 没有宠物切换条，进来就能拉第一页。
 *
 * 两种空态必须分开（这是本页最容易做错的地方）：「一只都没关注」该引去广场找宠物，
 * 「关注了但他们都没发过动态」引去关注列表看看关注了谁。合成一种会让前者以为
 * 关注流坏了。判据是 `followingCount` —— 服务端 `GET /me` 已经给了这个数，
 * 不必为了分空态再拉一遍关注列表。
 */
describe('关注流页配置与结构', () => {
  it('json 声明审核角标与空态，不声明页面级下拉刷新与触底', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      enablePullDownRefresh?: boolean;
      onReachBottomDistance?: number;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('关注动态');
    // Skyline 没有全局滚动，页面级的这两个属性没有载体 —— 留着会在 WebView
    // 回退路径上显示一个永不收回的刷新圈（同「我的动态」页的理由）。
    expect(json.enablePullDownRefresh).toBeUndefined();
    expect(json.onReachBottomDistance).toBeUndefined();
    const used = json.usingComponents ?? {};
    // feed 里全是别人 approved 的内容，角标理论上不出现 ——
    // 但复用组件比新写一份卡片可靠，也让「万一出现」时的口径与别处一致。
    expect(used['audit-badge']).toBe('/components/audit-badge/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['sq-button']).toBe('/components/sq-button/index');
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

  it('wxml 渲染动态列表，每条带宠物名、时间与图片', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('wx:for="{{posts}}"');
    expect(wxml).toContain('wx:key="id"');
    // feed 是跨宠物混排的，「这条是谁发的」必须显示 —— 不像「我的动态」那样
    // 靠页面顶部的切换条隐含。
    expect(wxml).toContain('{{item.petName}}');
    expect(wxml).toContain('{{item.content}}');
    expect(wxml).toContain('{{item.timeText}}');
    expect(wxml).toContain('<audit-badge');
    expect(wxml).toContain('status="{{item.auditStatus}}"');
    expect(wxml).toContain('reason="{{item.badge.reasonText}}"');
    expect(wxml).toContain('wx:for="{{item.images}}"');
    expect(wxml).toContain('bindtap="onImageTap"');
  });

  it('wxml 有两种空态：没关注任何宠物 / 关注了但没动态', () => {
    const wxml = read(`${DIR}/index.wxml`);
    expect(wxml).toContain('<empty-state');
    // 判据是 followingCount 的**三态**：0 = 一只没关注，>0 = 关注了但没动态，
    // -1 = 还没取到（两种空态都不显示，胜过指错方向）。
    // 所以这里断言的是两个显式比较，而不是 `!followingCount` —— 后者把
    // 「还没取到」和「一只没关注」混成同一支。
    expect(wxml).toContain('followingCount === 0');
    expect(wxml).toContain('followingCount > 0');
    expect(wxml).toContain('wx:elif');
    // 前者引去广场找宠物关注，后者引去关注列表看看关注了谁。
    expect(wxml).toContain('bind:tap="onGoPlaza"');
    expect(wxml).toContain('bind:tap="onGoFollowing"');
  });

  it('页面 ts 直接拉 feed，视图经 buildPostView，翻页走 mergePage', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchFeed');
    expect(ts).toContain('buildPostView');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toContain('onLoadMore');
    expect(ts).toContain('onRefresh');
    // 刷新态是受控位：取数失败也得复位，否则刷新圈不收。所以复位必须在 finally 里。
    expect(ts).toMatch(/finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/);
    expect(ts).toContain('wx.previewImage');
    // 分空态要的关注数从 `GET /me` 来 —— 不为了这一个数再拉一遍关注列表。
    expect(ts).toContain('fetchProfile');
    expect(ts).toContain('followingCount');
    // feed 不吃 petId（跨宠物混排）。断言**调用形状**而不是「源码里没有 petId
    // 这几个字」—— 后者会被解释这件事的注释撞红（audit-literal-guard 同款陷阱）。
    expect(ts).toMatch(/fetchFeed\(\{\s*page,\s*pageSize:\s*PAGE_SIZE\s*\}\)/);
    expect(ts).not.toContain('wx.request');
    // 状态判断只允许经 buildPostView / audit-badge。
    expect(ts).not.toContain("'approved'");
  });

  it('onShow 重拉第一页 —— 关注/取关之后回来内容会变', () => {
    const ts = read(`${DIR}/index.ts`);
    // onShow 走 init()，init 里 `loadPage(1, true)`：force 是必须的 ——
    // onShow 与 onLoad 可能挨得很近，不 force 会被 loading 闸门挡掉。
    expect(ts).toMatch(/onShow\(\)[\s\S]{0,400}this\.init\(\)/);
    expect(ts).toMatch(/init\(\)[\s\S]{0,400}loadPage\(1,\s*true\)/);
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});

describe('关注流页的注册与入口', () => {
  it('注册进 app.json 的 packages/profile 分包', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: { root: string; pages: string[] }[];
      tabBar: { list: { pagePath: string }[] };
    };
    const profile = app.subPackages.find((pkg) => pkg.root === 'packages/profile');
    expect(profile).toBeDefined();
    expect(profile?.pages).toContain('pages/feed/index');

    // **不改 tabBar**：阶段 0 的 tabBar 真机验证项还没闭合，动它会把两件事混在一起。
    expect(app.tabBar.list).toHaveLength(3);
    expect(app.tabBar.list.map((tab) => tab.pagePath)).toEqual([
      'pages/plaza/index',
      'pages/venue-list/index',
      'pages/profile/index',
    ]);
  });

  it('入口进个人中心的入口列表，紧邻「我的关注」', () => {
    const keys = PROFILE_ENTRIES.map((entry) => entry.key);
    expect(keys).toContain('feed');
    const feed = PROFILE_ENTRIES.find((entry) => entry.key === 'feed');
    expect(feed?.url).toBe('/packages/profile/pages/feed/index');
    expect(feed?.label).toBe('关注动态');
    // 与「我的关注」相邻：两者都是关注这件事的两面（关注了谁 / 他们发了什么）。
    expect(Math.abs(keys.indexOf('feed') - keys.indexOf('following'))).toBe(1);
  });

  it('每个入口的 url 都在 app.json 里真有对应页面（拦住写错路径）', () => {
    const app = JSON.parse(read('app.json')) as {
      subPackages: { root: string; pages: string[] }[];
    };
    const registered = new Set(
      app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `/${pkg.root}/${page}`)),
    );
    for (const entry of PROFILE_ENTRIES) {
      expect(registered.has(entry.url)).toBe(true);
    }
  });
});
