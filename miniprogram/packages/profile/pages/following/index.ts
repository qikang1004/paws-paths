import { fetchFollowing } from '../../../../api/follows';
import { mergePage, shouldLoadMore } from '../../../../utils/list-paging';
import { buildFeedItem, type FeedItem } from '../../../../utils/pet-card-view';

const PAGE_SIZE = 10;

/**
 * 我的关注。卡片与广场页是同一张（`pet-card-tpl` + `buildFeedItem`），
 * 所以这一页只做取数与翻页。
 *
 * 取关不在这里做：动作留在宠物详情页那一个开关上，这一页 `onShow` 重取第一页
 * 把结果同步回来 —— 两处各写一遍开关，迟早在「取关后要不要立刻消失」上分叉。
 */
Page({
  data: {
    items: [] as FeedItem[],
    page: 0,
    hasMore: true,
    loading: false,
  },

  onLoad() {
    void this.loadPage(1);
  },

  onShow() {
    // 首次进入由 onLoad 拉，这里只管从详情页返回的那次（可能刚取关）。
    if (this.data.page > 0) void this.loadPage(1);
  },

  onReachBottom() {
    if (!shouldLoadMore(this.data.hasMore, this.data.loading)) return;
    void this.loadPage(this.data.page + 1);
  },

  async onPullDownRefresh(): Promise<void> {
    try {
      await this.loadPage(1);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onPetTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    wx.navigateTo({ url: `/pages/pet-detail/index?id=${e.detail.id}` });
  },

  onGoPlaza() {
    wx.switchTab({ url: '/pages/plaza/index' });
  },

  async loadPage(page: number): Promise<void> {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await fetchFollowing({ page, pageSize: PAGE_SIZE });
      const next = res.items.map((pet) => buildFeedItem(pet));
      // 第一页从空列表合并，等价于替换：取关过的不能还留在上一次的结果里。
      const merged = mergePage(page === 1 ? [] : this.data.items, next, {
        page: res.page,
        hasMore: res.hasMore,
      });
      this.setData({ items: merged.items, page: merged.page, hasMore: merged.hasMore });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
