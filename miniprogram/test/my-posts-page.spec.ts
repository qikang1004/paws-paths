import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findBarePx, findHexLiterals, findUndefinedVars } from '../tools/style-guard';

const ROOT = resolve(__dirname, '..');
const TOKENS = readFileSync(join(ROOT, 'styles/tokens.wxss'), 'utf8');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const DIR = 'packages/profile/pages/my-posts';

/**
 * 「我的动态」。`GET /posts` 的 `petId` 必填，所以这页先取「我的宠物」、
 * 选中一只，再按宠物翻页 —— 这里钉住的正是这条顺序，以及角标一律经
 * `audit-badge` / `buildPostView` 出（业务代码不自己判 `approved`，spec §4.5）。
 */
describe('我的动态页配置与结构', () => {
  /**
   * 下拉刷新与触底都搬到了 scroll-view 上（Skyline 不提供全局滚动，页面级的
   * `enablePullDownRefresh` / `onReachBottomDistance` 没有载体），所以这里反过来
   * 钉住它们不在 json 里——留着会在 WebView 回退路径上显示一个永不收回的刷新圈。
   */
  it('json 声明审核角标与空态，不再声明页面级下拉刷新与触底', () => {
    const json = JSON.parse(read(`${DIR}/index.json`)) as {
      navigationBarTitleText?: string;
      enablePullDownRefresh?: boolean;
      onReachBottomDistance?: number;
      usingComponents?: Record<string, string>;
    };
    expect(json.navigationBarTitleText).toBe('我的动态');
    expect(json.enablePullDownRefresh).toBeUndefined();
    expect(json.onReachBottomDistance).toBeUndefined();
    const used = json.usingComponents ?? {};
    expect(used['audit-badge']).toBe('/components/audit-badge/index');
    expect(used['empty-state']).toBe('/components/empty-state/index');
    expect(used['sq-button']).toBe('/components/sq-button/index');
  });

  it('wxml 有宠物切换、动态列表与两种空态', () => {
    const wxml = read(`${DIR}/index.wxml`);
    // 多只宠物才需要切换条，一只时那行只会是块噪声。
    expect(wxml).toContain('wx:if="{{pets.length > 1}}"');
    expect(wxml).toContain('wx:for="{{pets}}"');
    expect(wxml).toContain('bindtap="onPetTap"');
    expect(wxml).toContain('wx:for="{{posts}}"');
    expect(wxml).toContain('wx:key="id"');
    expect(wxml).toContain('{{item.content}}');
    expect(wxml).toContain('{{item.timeText}}');
    // 角标只把状态与原因交给组件，显不显示由 buildAuditBadge 决定。
    expect(wxml).toContain('<audit-badge');
    expect(wxml).toContain('status="{{item.auditStatus}}"');
    expect(wxml).toContain('reason="{{item.badge.reasonText}}"');
    expect(wxml).toContain('wx:for="{{item.images}}"');
    expect(wxml).toContain('bindtap="onImageTap"');
    // 没宠物与有宠物但没动态是两回事：前者该引去建宠物，后者引去发布页。
    expect(wxml).toContain('wx:if="{{!pets.length && !loading}}"');
    expect(wxml).toContain('<empty-state');
    expect(wxml).toContain('bind:tap="onCreatePet"');
    expect(wxml).toContain('bind:tap="onCompose"');
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

  it('页面 ts 先取宠物再按宠物翻页，视图经 buildPostView', () => {
    const ts = read(`${DIR}/index.ts`);
    expect(ts).toContain('fetchMyPets');
    expect(ts).toContain('fetchPosts');
    expect(ts).toContain('buildPetOptions');
    expect(ts).toContain('resolvePetId');
    expect(ts).toContain('buildPostView');
    expect(ts).toContain('mergePage');
    expect(ts).toContain('shouldLoadMore');
    expect(ts).toContain('onLoadMore');
    expect(ts).toContain('onRefresh');
    // 刷新态是受控位：取数失败也得复位，否则刷新圈不收。所以复位必须在 finally 里。
    expect(ts).toMatch(/finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/);
    expect(ts).toContain('wx.previewImage');
    expect(ts).toContain('/packages/post/pages/compose/index?petId=');
    expect(ts).toContain('/packages/profile/pages/pet-edit/index');
    // 发完动态回来要能看见那条「审核中」，所以 onShow 重拉第一页。
    expect(ts).toMatch(/onShow\(\)[\s\S]{0,400}loadPage\(1\)/);
    expect(ts).not.toContain('wx.request');
    // 状态判断只允许经 buildPostView / audit-badge。
    expect(ts).not.toContain("'approved'");
  });

  it('wxss 不出现色值字面量、裸 px、未定义 token', () => {
    const css = read(`${DIR}/index.wxss`);
    expect(findHexLiterals(css)).toEqual([]);
    expect(findBarePx(css)).toEqual([]);
    expect(findUndefinedVars(css, TOKENS)).toEqual([]);
  });
});
