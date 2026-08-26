import { fetchMyPets } from '../../../../api/me';
import { fetchPosts } from '../../../../api/posts';
import { mergePage, shouldLoadMore } from '../../../../utils/list-paging';
import { buildPetOptions, resolvePetId, type PetOption } from '../../../../utils/my-pets-view';
import { buildPostView, type PostView } from '../../../../utils/post-view';

const PAGE_SIZE = 10;

/**
 * 我的动态。
 *
 * `GET /posts` 的 `petId` 必填（服务端没有全局信息流），所以这页得先取「我的宠物」、
 * 定下一只，才有列表可拉 —— 一只宠物都没有时走「先建一只」的空态，而不是拿空 id
 * 去请求一次注定 422 的列表。
 *
 * 审核状态一律经 `buildPostView` / `audit-badge` 呈现，页面自己不判 `approved`
 * （spec §4.5）：这页给的是作者视角，看得见自己那条「审核中」，但文案与可见性的
 * 口径必须和别处同一份。
 */
Page({
  data: {
    pets: [] as PetOption[],
    petId: '',
    posts: [] as PostView[],
    page: 0,
    hasMore: true,
    loading: false,
  },

  onLoad() {
    void this.init('');
  },

  onShow() {
    // 首次进入由 onLoad 拉，那一发还在飞时这里直接让开。
    if (this.data.loading) return;
    // 刚建完宠物回来：切换条还是空的，得把宠物清单重新取一遍。
    if (!this.data.pets.length) {
      void this.init(this.data.petId);
      return;
    }
    // 发完动态回来：重拉第一页，才看得见新那条的「审核中」角标。
    void this.loadPage(1);
  },

  onReachBottom() {
    if (!shouldLoadMore(this.data.hasMore, this.data.loading)) return;
    void this.loadPage(this.data.page + 1);
  },

  async onPullDownRefresh(): Promise<void> {
    try {
      await this.init(this.data.petId);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onPetTap(e: WechatMiniprogram.BaseEvent) {
    const petId = String(e.currentTarget.dataset.id ?? '');
    if (!petId || petId === this.data.petId) return;
    this.setData({ petId, posts: [], page: 0, hasMore: true });
    // force：切宠物必须立刻生效，上一只那发响应会被 loadPage 里的过期检查丢掉。
    void this.loadPage(1, true);
  },

  onImageTap(e: WechatMiniprogram.BaseEvent) {
    const { post: postId, index } = e.currentTarget.dataset;
    const post = this.data.posts.find((item) => item.id === String(postId));
    if (!post) return;
    const urls = post.images.map((image) => image.url);
    const current = urls[Number(index)] ?? urls[0];
    if (!current) return;
    wx.previewImage({ current, urls });
  },

  onCompose() {
    wx.navigateTo({ url: `/packages/post/pages/compose/index?petId=${this.data.petId}` });
  },

  onCreatePet() {
    wx.navigateTo({ url: '/packages/profile/pages/pet-edit/index' });
  },

  /** 取宠物清单 → 定下选中那只 → 拉它的第一页。`preferred` 让刷新不改变选中项。 */
  async init(preferred: string): Promise<void> {
    this.setData({ loading: true });
    try {
      const res = await fetchMyPets();
      const pets = buildPetOptions(res.items);
      const petId = resolvePetId(pets, preferred);
      this.setData({ pets, petId, posts: [], page: 0, hasMore: true });
      if (!petId) return;
      await this.loadPage(1, true);
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadPage(page: number, force = false): Promise<void> {
    if (!force && this.data.loading) return;
    if (!this.data.petId) return;
    this.setData({ loading: true });
    try {
      const petId = this.data.petId;
      const res = await fetchPosts({ petId, page, pageSize: PAGE_SIZE });
      // 人切得比响应快时，这份结果已经不是当前那只宠物的了 —— 丢掉，不然列表会串。
      if (petId !== this.data.petId) return;
      const next = res.items.map((post) => buildPostView(post));
      const merged = mergePage(page === 1 ? [] : this.data.posts, next, {
        page: res.page,
        hasMore: res.hasMore,
      });
      this.setData({ posts: merged.items, page: merged.page, hasMore: merged.hasMore });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
