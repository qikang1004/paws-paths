import { addFavorite, fetchVenueDetail, removeFavorite } from '../../../../api/venues';
import { openMapNavigation } from '../../../../utils/navigation';
import { detailView, type VenueDetailView } from './venue-detail-model';

Page({
  data: {
    poiId: '',
    view: null as VenueDetailView | null,
    favorite: false,
    favoriting: false,
    error: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ poiId: query.poiId ?? '' });
    void this.load();
  },

  onRetry() {
    void this.load();
  },

  onCopyAddress() {
    const view = this.data.view;
    if (!view) return;
    wx.setClipboardData({ data: view.address });
  },

  onNavigate() {
    const view = this.data.view;
    // showNavigation 已经保证坐标齐全，这里再挡一次避免竞态下的空值。
    if (!view || view.lat == null || view.lng == null) return;
    openMapNavigation(view.lat, view.lng, view.name);
  },

  async onToggleFavorite(): Promise<void> {
    if (!this.data.view || this.data.favoriting) return;
    const next = !this.data.favorite;
    this.setData({ favoriting: true });
    try {
      const res = next
        ? await addFavorite(this.data.poiId)
        : await removeFavorite(this.data.poiId);
      // 以服务端返回的状态为准，不假设本地翻转一定成功。
      this.setData({ favorite: res.isFavorite });
      wx.showToast({ title: res.isFavorite ? '已收藏' : '已取消收藏', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '操作失败', icon: 'none' });
    } finally {
      this.setData({ favoriting: false });
    }
  },

  async load(): Promise<void> {
    if (!this.data.poiId) {
      this.setData({ error: true });
      return;
    }
    this.setData({ error: false });
    try {
      const venue = await fetchVenueDetail(this.data.poiId);
      this.setData({ view: detailView(venue), favorite: venue.isFavorite, error: false });
    } catch {
      this.setData({ view: null, error: true });
    }
  },
});
