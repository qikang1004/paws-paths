import { fetchHistory } from '../../../../api/me';
import { mergePage, shouldLoadMore } from '../../../../utils/list-paging';
import {
  buildHistoryRow,
  groupByDay,
  type DaySection,
  type MixedRow,
} from '../../../../utils/mixed-list-view';

const PAGE_SIZE = 20;

/**
 * 浏览历史。按天分段展示，宠物与场所混排（行装配与「我的收藏」共用一份）。
 *
 * `rows` 留着未分段的整份列表，分段每次从它重算：只对新一页分段的话，
 * 跨页的同一天会分裂成两个「今天」标题。
 */
Page({
  data: {
    rows: [] as MixedRow[],
    sections: [] as DaySection[],
    page: 0,
    hasMore: true,
    loading: false,
    /** scroll-view 刷新态的受控位。刷完必须置回 false，否则刷新圈不收。 */
    refreshing: false,
  },

  onLoad() {
    void this.loadPage(1);
  },

  /**
   * 触底加载与下拉刷新都挂在 scroll-view 的属性上，不用页面的
   * `onReachBottom` / `onPullDownRefresh` —— Skyline 没有全局滚动，
   * 那两个页面级回调不会被触发。
   */
  onLoadMore() {
    if (!shouldLoadMore(this.data.hasMore, this.data.loading)) return;
    void this.loadPage(this.data.page + 1);
  },

  async onRefresh(): Promise<void> {
    this.setData({ refreshing: true });
    try {
      await this.loadPage(1);
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onRowTap(e: WechatMiniprogram.BaseEvent) {
    wx.navigateTo({ url: String(e.currentTarget.dataset.url) });
  },

  async loadPage(page: number): Promise<void> {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await fetchHistory({ page, pageSize: PAGE_SIZE });
      const next = res.items.map((item) => buildHistoryRow(item));
      const merged = mergePage(page === 1 ? [] : this.data.rows, next, {
        page: res.page,
        hasMore: res.hasMore,
      });
      this.setData({
        rows: merged.items,
        sections: groupByDay(merged.items),
        page: merged.page,
        hasMore: merged.hasMore,
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
