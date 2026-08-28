import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

interface AppJson {
  pages: string[];
  subPackages: { root: string; pages: string[] }[];
  rendererOptions?: { skyline?: Record<string, unknown> };
}

const app = JSON.parse(read('app.json')) as AppJson;
const allPages = [
  ...app.pages,
  ...app.subPackages.flatMap((pkg) => pkg.pages.map((page) => `${pkg.root}/${page}`)),
];

/**
 * 占位页豁免不写死名单——按内容认：只有一行、写着「占位页」的，等它被填实了
 * 自动落回守卫，不会因为名单没人维护而漏掉。
 */
const isPlaceholder = (wxml: string): boolean =>
  wxml.trim().split('\n').length === 1 && wxml.includes('占位页');

const realPages = allPages.filter((page) => !isPlaceholder(read(`${page}.wxml`)));

/**
 * Skyline 不提供全局滚动（官方最佳实践原话：「Skyline no longer provides global
 * scrolling, using scroll-view for areas where scrolling is required」），页面根节点
 * 不是滚动容器，页面照样滑不动。修法是每个页面用一个铺满的 scroll-view 承载内容。
 *
 * 这份守卫遍历 app.json 声明的全部页面，所以新加的页面漏套容器会在这里红，
 * 不用指望每个页面各自的 spec 都记得钉这一条。
 */
describe('页面滚动容器（Skyline 没有全局滚动）', () => {
  it('占位页之外的页面都有内容，名单不为空', () => {
    // 万一豁免规则写歪把所有页面都滤掉了，下面的遍历会静默全过。
    expect(realPages.length).toBeGreaterThan(8);
  });

  it.each(realPages)('%s 的根节点是铺满的 scroll-view', (page) => {
    const wxml = read(`${page}.wxml`);
    // 去掉开头的注释再看第一个标签，注释是这次改动到处都写的。
    const firstTag = wxml.replace(/<!--[\s\S]*?-->/g, '').trim();
    expect(firstTag.startsWith('<scroll-view')).toBe(true);
    expect(wxml).toContain('class="page-scroll"');
    // scroll-y 默认 false，不显式给就还是不滚。
    expect(wxml).toContain('scroll-y="{{true}}"');
  });

  it.each(allPages)('%s 不再声明页面级下拉刷新与触底', (page) => {
    const json = JSON.parse(read(`${page}.json`)) as Record<string, unknown>;
    expect(json.enablePullDownRefresh).toBeUndefined();
    expect(json.onReachBottomDistance).toBeUndefined();
  });

  it.each(allPages)('%s 不再挂页面级滚动生命周期', (page) => {
    const ts = read(`${page}.ts`);
    // 去掉注释再看：好几处注释里正提到这些旧名字，说明「为什么搬走了」。
    const code = ts.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // 这两个回调依附页面级滚动，Skyline 下永不触发——留着就是静默失效的翻页。
    expect(code).not.toMatch(/\bonReachBottom\s*\(/);
    expect(code).not.toMatch(/\bonPullDownRefresh\s*\(/);
    expect(code).not.toMatch(/\bstopPullDownRefresh\s*\(/);
  });

  it('刷新态是受控位：用了 refresher 的页面必须在 finally 里复位', () => {
    const withRefresher = realPages.filter((page) =>
      read(`${page}.wxml`).includes('refresher-enabled'),
    );
    expect(withRefresher.length).toBeGreaterThan(0);
    for (const page of withRefresher) {
      const wxml = read(`${page}.wxml`);
      expect(wxml).toContain('refresher-triggered="{{refreshing}}"');
      // 取数失败也得复位，否则刷新圈不收，页面看着像卡住。
      expect(read(`${page}.ts`)).toMatch(
        /finally\s*\{\s*this\.setData\(\{\s*refreshing:\s*false/,
      );
    }
  });

  it('触底加载的页面给了阈值，且走 shouldLoadMore 挡重复请求', () => {
    const withLower = realPages.filter((page) =>
      read(`${page}.wxml`).includes('bindscrolltolower'),
    );
    expect(withLower.length).toBeGreaterThan(0);
    for (const page of withLower) {
      expect(read(`${page}.wxml`)).toContain('lower-threshold="200"');
      expect(read(`${page}.ts`)).toContain('shouldLoadMore');
    }
  });

  it('app.wxss 给 page 确定高度与纵向 flex，否则 flex:1 的容器算不出剩余空间', () => {
    const css = read('app.wxss');
    const pageRule = /page\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(pageRule).toContain('height: 100%');
    expect(pageRule).toContain('display: flex');
    expect(pageRule).toContain('flex-direction: column');
  });

  it('.page-scroll 用 flex:1 + height:0 撑满剩余高度', () => {
    const rule = /\.page-scroll\s*\{[^}]*\}/.exec(read('styles/semantic.wxss'))?.[0] ?? '';
    expect(rule).toContain('flex: 1');
    // flex 子项默认 min-height:auto，内容比容器高时会把容器顶开，flex:1 就白给了。
    expect(rule).toContain('height: 0');
  });

  it('app.json 开启 scroll-view 自动尺寸', () => {
    expect(app.rendererOptions?.skyline?.enableScrollViewAutoSize).toBe(true);
  });
});
