import { followPet, unfollowPet } from '../../api/follows';
import { fetchPetDetail } from '../../api/pets';
import { locationStore } from '../../store/location';
import { buildDetailView, followTextOf, type DetailView } from './detail-model';

Page({
  data: {
    petId: '',
    view: null as DetailView | null,
    loading: false,
    error: false,
    /**
     * 关注请求在飞。挡连点 —— 关注/取关**不**满足「点两次等于点一次」的直觉：
     * 连点会打出两个方向相反的请求，最终态取决于哪个先回。
     */
    following: false,
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

  /**
   * 关注 / 取消关注。
   *
   * **不做乐观更新**：关注态是关注流的入口条件，显示成功而实际没写进去，
   * 用户会以为 feed 该有内容却一直是空的。所以先等服务端回，再改本地态。
   *
   * 成功后**就地翻转两个字段**，不重拉详情 —— 整页 loading 会把相册和滚动位置
   * 一起重置。翻转用 `'view.isFollowing'` 这种路径式 setData：只改那一格，
   * 不必把整个 view 对象重建一遍。
   */
  async onToggleFollow(): Promise<void> {
    if (this.data.following) return;
    const view = this.data.view;
    if (!view || !view.showFollow) return;

    const next = !view.isFollowing;
    this.setData({ following: true });
    try {
      // 目标态决定调哪个端点。两个都是幂等的，重复调不报错。
      const res = next ? await followPet(view.id) : await unfollowPet(view.id);
      // 听服务端回的那个值，不听本地推算的 `next` —— 两者理应一致，
      // 但真不一致时该显示的是库里的事实。
      this.setData({
        'view.isFollowing': res.isFollowing,
        'view.followText': followTextOf(res.isFollowing),
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '操作失败', icon: 'none' });
    } finally {
      // 一律复位：失败一次就永久禁用按钮的话，用户只能退出重进。
      this.setData({ following: false });
    }
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
