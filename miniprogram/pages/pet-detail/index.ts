import { fetchPetDetail } from '../../api/pets';
import { locationStore } from '../../store/location';
import { buildDetailView, type DetailView } from './detail-model';

Page({
  data: {
    petId: '',
    view: null as DetailView | null,
    loading: false,
    error: false,
  },

  onLoad(query: Record<string, string | undefined>) {
    this.setData({ petId: query.id ?? '' });
    void this.load();
  },

  onRetry() {
    void this.load();
  },

  onPhotoTap(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const view = this.data.view;
    if (!view) return;
    wx.previewImage({ urls: view.urls, current: view.urls[e.detail.index] });
  },

  /** 分享出去的链接要能直接落回这只宠物，所以带上 id。 */
  onShareAppMessage(): WechatMiniprogram.Page.ICustomShareContent {
    const view = this.data.view;
    return {
      title: view ? view.name : '来看看这只毛孩子',
      path: `/pages/pet-detail/index?id=${this.data.petId}`,
    };
  },

  async load(): Promise<void> {
    if (!this.data.petId) {
      this.setData({ error: true });
      return;
    }
    this.setData({ loading: true, error: false });
    // 详情页不自己要授权：广场进来时通常已有坐标，没有就按无距离渲染。
    const state = locationStore.state;
    const coords = state && state.mode === 'precise' ? state.coords : null;
    try {
      const pet = await fetchPetDetail(
        this.data.petId,
        undefined,
        coords?.latitude,
        coords?.longitude,
      );
      this.setData({ view: buildDetailView(pet), error: false });
    } catch {
      // 404 与网络失败对用户是同一件事：这页现在打不开，给个重试。
      this.setData({ view: null, error: true });
    } finally {
      this.setData({ loading: false });
    }
  },
});
