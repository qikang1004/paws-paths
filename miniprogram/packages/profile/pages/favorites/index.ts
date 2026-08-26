import { fetchFavorites } from '../../../../api/me';
import { unfavoritePet } from '../../../../api/pets';
import { removeFavorite } from '../../../../api/venues';
import { dropById, mergePage, shouldLoadMore } from '../../../../utils/list-paging';
import { buildFavoriteRow, type MixedRow } from '../../../../utils/mixed-list-view';

const PAGE_SIZE = 20;

/**
 * 我的收藏。宠物与场所混排 —— 收藏本身是多态的（spec §4.2），
 * 行装配复用 `buildFavoriteRow`（与浏览历史同一份）。
 *
 * 取消收藏按目标类型分派到两个接口：收藏动作挂在各自的资源上
 * （`/pets/:id/favorite`、`/venues/:poiId/favorite`），没有统一的 `/me/favorites/:id`。
 */
Page({
  data: {
    rows: [] as MixedRow[],
    page: 0,
    hasMore: true,
    loading: false,
    /** 正在取消的行 id，防止连点发两次请求。 */
    busyId: '',
  },

  onLoad() {
    void this.loadPage(1);
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

  onRowTap(e: WechatMiniprogram.BaseEvent) {
    wx.navigateTo({ url: String(e.currentTarget.dataset.url) });
  },

  async onUnfavorite(e: WechatMiniprogram.BaseEvent): Promise<void> {
    const id = String(e.currentTarget.dataset.id);
    if (this.data.busyId) return;
    const row = this.data.rows.find((item) => item.id === id);
    if (!row) return;

    this.setData({ busyId: id });
    try {
      if (row.targetType === 'pet') {
        await unfavoritePet(row.targetId);
      } else {
        await removeFavorite(row.targetId);
      }
      // 本地摘行：重拉一整页只为了少一行，翻页位置还会跳回顶部。
      this.setData({ rows: dropById(this.data.rows, id) });
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ busyId: '' });
    }
  },

  async loadPage(page: number): Promise<void> {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await fetchFavorites({ page, pageSize: PAGE_SIZE });
      const next = res.items.map((item) => buildFavoriteRow(item));
      const merged = mergePage(page === 1 ? [] : this.data.rows, next, {
        page: res.page,
        hasMore: res.hasMore,
      });
      this.setData({ rows: merged.items, page: merged.page, hasMore: merged.hasMore });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
