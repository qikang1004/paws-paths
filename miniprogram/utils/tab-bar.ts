interface TabBarInstance {
  syncActive(): void;
}

/** 在每个 tab 页面的 onShow 里调用，保证高亮跟当前页一致。 */
export function syncTabBar(page: WechatMiniprogram.Page.TrivialInstance): void {
  const bar = page.getTabBar?.() as unknown as TabBarInstance | undefined;
  bar?.syncActive();
}
