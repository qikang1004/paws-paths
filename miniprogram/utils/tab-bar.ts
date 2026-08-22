interface TabBarInstance {
  syncActive(): void;
}

type GetTabBarResult = TabBarInstance | undefined;

/**
 * 兼容两种渲染器的 getTabBar 形态：
 * - WebView：同步返回实例；
 * - Skyline：只接受回调，同步调用返回 undefined，实例经回调异步送达
 *   （官方 Skyline 适配指南的 `this.getTabBar((tabBar) => ...)` 形态）。
 */
function resolveTabBar(
  getTabBar: NonNullable<WechatMiniprogram.Page.TrivialInstance['getTabBar']>,
  onResolved: (bar: TabBarInstance) => void,
): void {
  const sync = getTabBar() as unknown;
  if (sync && typeof (sync as TabBarInstance).syncActive === 'function') {
    onResolved(sync as TabBarInstance);
    return;
  }
  // Skyline 形态：无参调用返回 undefined，改走回调。
  (getTabBar as (cb: (bar: TabBarInstance) => void) => unknown)((bar) => {
    if (bar) onResolved(bar);
  });
}

/** 在每个 tab 页面的 onShow 里调用，保证高亮跟当前页一致。 */
export function syncTabBar(page: WechatMiniprogram.Page.TrivialInstance): void {
  if (typeof page.getTabBar !== 'function') return;
  resolveTabBar(page.getTabBar.bind(page), (bar) => bar.syncActive());
}
