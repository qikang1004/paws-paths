import { fetchProfile } from '../../../../api/me';
import { fetchFeed } from '../../../../api/posts';
import { reportImage, reportPost } from '../../../../api/reports';
import { dropById, mergePage, shouldLoadMore } from '../../../../utils/list-paging';
import { buildPostView, dropImageById, type PostView } from '../../../../utils/post-view';
import {
  REPORT_REASON_LABEL_LIST,
  REPORT_REASON_OPTIONS,
  reasonAt,
} from '../../../../utils/report-view';
import type { ReportReason } from '../../../../shared/types/index';

const PAGE_SIZE = 10;

/**
 * 选举报原因。取消返回 `null`。
 *
 * 用 `wx.showActionSheet` 而不是自定义弹层：白名单恰好 6 项，正好是它的上限
 * （`ACTION_SHEET_MAX_ITEMS`，`report-view.ts` 里有条断言钉着这件事）。
 * 再加一种原因就装不进了，那时该换成自定义选择器，而不是静默截断。
 */
function pickReason(): Promise<ReportReason | null> {
  return new Promise((resolve) => {
    wx.showActionSheet({
      itemList: [...REPORT_REASON_LABEL_LIST],
      // `fail` 里也要 resolve：用户点蒙层关掉时走的是 fail 而不是 success，
      // 漏了它这条 Promise 永远不 settle，`reportingId` 就再也复位不了。
      success: (res) => resolve(reasonAt(res.tapIndex)),
      fail: () => resolve(null),
    });
  });
}

/** 二次确认。举报不可撤销，且会让内容对所有人消失。 */
function confirmReport(): Promise<boolean> {
  return confirm(
    '举报这条动态？',
    '提交后这条内容会立刻隐藏，等运营复核。复核通过它会重新出现。',
  );
}

/**
 * 举报单张图片的确认。文案与上面**必须不同** —— 用户长按一张图时弹
 * 「举报这条动态？」会让他以为整条要被撤下，而实际上只有那张图会消失。
 */
function confirmImageReport(): Promise<boolean> {
  return confirm(
    '举报这张图片？',
    '只有这张图会被隐藏等复核，动态的文字和其他图片不受影响。',
  );
}

/** 两个确认框共用的实现。`fail` 也 resolve —— 理由同 `pickReason`。 */
function confirm(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: '举报',
      success: (res) => resolve(res.confirm),
      fail: () => resolve(false),
    });
  });
}

/**
 * 关注流。
 *
 * 与「我的动态」页最大的不同：`GET /me/feed` **不吃 petId**（跨宠物混排），
 * 所以没有宠物切换条，进来就能拉第一页。别照抄那一页的取数顺序。
 *
 * 服务端保证 feed 里既没有未过审的内容、也没有自己发的动态
 * （Global Constraint 29 / 30），所以这页不做任何过滤 —— 客户端再筛一遍就是
 * 第二份判定，两处迟早分叉，而服务端那份才是安全边界。
 *
 * `followingCount` 只为**分空态**而取：「一只都没关注」与「关注了但他们没发过」
 * 该引去两个不同的地方，合成一种会让前者以为关注流坏了。这个数 `GET /me` 已经给了，
 * 不必为它再拉一遍关注列表。
 */
Page({
  data: {
    posts: [] as PostView[],
    /** 关注了几只。仅用于分空态；-1 表示还没取到，两种空态都先不显示。 */
    followingCount: -1,
    page: 0,
    hasMore: true,
    loading: false,
    /** scroll-view 刷新态的受控位。刷完必须置回 false，否则刷新圈不收。 */
    refreshing: false,
    /** 正在举报哪一条。挡连点，也让那张卡上的按钮禁用。 */
    reportingId: '',
  },

  onLoad() {
    void this.init();
  },

  onShow() {
    // 首次进入由 onLoad 拉，那一发还在飞时这里直接让开。
    if (this.data.loading) return;
    // 关注/取关之后回来，能看的内容就变了 —— 重拉第一页。
    void this.init();
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
      await this.init();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onImageTap(e: WechatMiniprogram.BaseEvent) {
    const { post: id, index } = e.currentTarget.dataset;
    const post = this.data.posts.find((item) => item.id === String(id));
    if (!post) return;
    const urls = post.images.map((image) => image.url);
    const current = urls[Number(index)] ?? urls[0];
    if (!current) return;
    wx.previewImage({ current, urls });
  },

  onGoPlaza() {
    // 广场是 tab 页，只能 switchTab —— navigateTo 到 tab 页会静默失败。
    wx.switchTab({ url: '/pages/plaza/index' });
  },

  onGoFollowing() {
    wx.navigateTo({ url: '/packages/profile/pages/following/index' });
  },

  /**
   * 举报一条动态：**先选原因，再确认，才发请求**。
   *
   * 两步而不是一步：原因是必填的（服务端白名单校验），而举报本身是不可撤销的 ——
   * 内容会立刻对所有人消失，等运营复核。只弹一个确认框就发，等于让人在没选原因的
   * 情况下做一个撤不回的动作。
   *
   * 回调式的 `wx.showActionSheet` / `wx.showModal` 包成 Promise，让这条链读起来
   * 是顺序的 —— 嵌套两层 success 回调时，「取消」那几条分支很容易漏。
   */
  onReport(e: WechatMiniprogram.BaseEvent) {
    if (this.data.reportingId) return;
    const id = String(e.currentTarget.dataset.id ?? '');
    if (!id) return;
    void this.runReport(id);
  },

  async runReport(id: string): Promise<void> {
    const reason = await pickReason();
    // 取消选原因：什么都不做，不提示 —— 用户自己关掉的面板不需要回执。
    if (!reason) return;
    if (!(await confirmReport())) return;
    await this.submitReport(id, reason);
  },

  async submitReport(id: string, reason: ReportReason): Promise<void> {
    if (this.data.reportingId) return;
    this.setData({ reportingId: id });
    try {
      await reportPost(id, reason);
      // 举报成功后这条内容迁到 pending_review，**对举报人自己也不可见了** ——
      // 所以那一行必须当场消失。不重拉那一页：服务端那一页已经少了一条、
      // 内容会往前挪，重拉既跳位置又会把下一页的内容提上来。
      this.setData({ posts: dropById(this.data.posts, id) });
      // 说的是「已提交复核」而不是「已删除」：内容并没有被删，复核通过还会回来。
      wx.showToast({ title: '已提交复核', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '举报失败', icon: 'none' });
    } finally {
      // 一律复位：失败一次就永久禁用的话，用户只能退出重进。
      this.setData({ reportingId: '' });
    }
  },

  /**
   * 长按一张图 → 举报**那张图**。
   *
   * 与举报整条动态是两件事：图片与动态的审核状态独立，撤下一张图不影响文字。
   * 用长按而不是再加一个按钮 —— 九宫格里每张图都配一个「举报」会把卡片挤满，
   * 而长按是相册类界面里已有的惯例（点开预览、长按出操作）。
   *
   * `reportingId` 与举报整条动态共用：同一时刻只该有一次举报在飞。
   */
  onReportImage(e: WechatMiniprogram.BaseEvent) {
    if (this.data.reportingId) return;
    const { post: postId, image: imageId } = e.currentTarget.dataset;
    const post = String(postId ?? '');
    const image = String(imageId ?? '');
    if (!post || !image) return;
    void this.runImageReport(post, image);
  },

  async runImageReport(postId: string, imageId: string): Promise<void> {
    const reason = await pickReason();
    if (!reason) return;
    if (!(await confirmImageReport())) return;
    await this.submitImageReport(postId, imageId, reason);
  },

  async submitImageReport(
    postId: string,
    imageId: string,
    reason: ReportReason,
  ): Promise<void> {
    if (this.data.reportingId) return;
    // 键控用图片 id：同一条动态里长按另一张图是另一次举报。
    this.setData({ reportingId: imageId });
    try {
      await reportImage(imageId, reason);
      // 只摘那一张图，动态本身留着 —— dropById 会把整条删掉，那是错的。
      // dropImageById 顺带重算 hasImages（摘掉最后一张时那个 wx:if 得关）。
      this.setData({ posts: dropImageById(this.data.posts, postId, imageId) });
      wx.showToast({ title: '已提交复核', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '举报失败', icon: 'none' });
    } finally {
      this.setData({ reportingId: '' });
    }
  },

  /** 关注数与第一页一起取。两发并行 —— 它们互不依赖，串起来白等一个 RTT。 */
  async init(): Promise<void> {
    await Promise.all([this.loadFollowingCount(), this.loadPage(1, true)]);
  },

  /**
   * 取关注数。**失败不弹 toast**：它只影响空态文案该指向哪里，
   * 而列表本身那一发失败时已经提示过了 —— 两条 toast 叠在一起没有意义。
   */
  async loadFollowingCount(): Promise<void> {
    try {
      const profile = await fetchProfile();
      this.setData({ followingCount: profile.followingCount });
    } catch {
      // 保持 -1：两种空态都不显示，胜过指错方向。
    }
  },

  async loadPage(page: number, force = false): Promise<void> {
    if (!force && this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await fetchFeed({ page, pageSize: PAGE_SIZE });
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
