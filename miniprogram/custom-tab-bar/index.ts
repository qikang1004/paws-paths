import { TABS, activeIndexFor } from './tabs';

Component({
  data: { tabs: TABS, active: 0 },
  attached() {
    this.syncActive();
  },
  methods: {
    /** 自定义 tabBar 实例不随 switchTab 重建，必须由页面 onShow 主动同步。 */
    syncActive(): void {
      const pages = getCurrentPages();
      const route = pages[pages.length - 1]?.route ?? '';
      const index = activeIndexFor(route);
      if (index >= 0 && index !== this.data.active) this.setData({ active: index });
    },

    onTap(e: WechatMiniprogram.TouchEvent): void {
      const index = Number(e.currentTarget.dataset.index);
      const target = TABS[index];
      if (!target || index === this.data.active) return;
      // 先改高亮再跳，避免等页面切换完才变色的迟滞感。
      this.setData({ active: index });
      wx.switchTab({ url: `/${target.pagePath}` });
    },
  },
});
