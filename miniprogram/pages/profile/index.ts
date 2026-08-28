import { pickAndUploadImages } from '../../api/media';
import { fetchMyPets, fetchProfile, updateProfile } from '../../api/me';
import { syncTabBar } from '../../utils/tab-bar';
import {
  NICKNAME_MAX_LENGTH,
  PROFILE_ENTRIES,
  buildPetTile,
  buildProfileView,
  type PetTile,
  type ProfileView,
} from './profile-model';
import type { ProfileDto } from '../../shared/types/index';

Page({
  data: {
    view: buildProfileView(null) as ProfileView,
    pets: [] as PetTile[],
    entries: PROFILE_ENTRIES,
    loading: false,
    /** scroll-view 刷新态的受控位。刷完必须置回 false，否则刷新圈不收。 */
    refreshing: false,
  },

  /**
   * 每次回到这个页面都重取：从宠物编辑页建了只新宠物、在关注列表里取关了谁，
   * 计数都变了。个人中心是这些页面的返回落点，缓存旧数字只会让人以为没生效。
   */
  onShow() {
    syncTabBar(this);
    void this.load();
  },

  /**
   * 下拉刷新。挂在 scroll-view 的 `bindrefresherrefresh` 上而不是页面的
   * `onPullDownRefresh` —— Skyline 没有全局滚动，页面级回调没有载体。
   */
  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.load();
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onEntryTap(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: String(e.currentTarget.dataset.url) });
  },

  onPetTap(e: WechatMiniprogram.TouchEvent) {
    wx.navigateTo({ url: String(e.currentTarget.dataset.url) });
  },

  onCreatePet() {
    // 不带 id 就是新建 —— 编辑页按有没有 id 分岔。
    wx.navigateTo({ url: '/packages/profile/pages/pet-edit/index' });
  },

  /** 改昵称用系统弹窗的可编辑输入框：为一个字段单开一个页面不值得。 */
  onEditNickname() {
    wx.showModal({
      title: '改个名字',
      editable: true,
      placeholderText: `最多 ${NICKNAME_MAX_LENGTH} 字`,
      content: this.data.view.nickname,
      success: (res) => {
        if (!res.confirm) return;
        void this.saveNickname(res.content ?? '');
      },
    });
  },

  async saveNickname(raw: string): Promise<void> {
    const nickname = raw.trim();
    if (nickname.length === 0) {
      wx.showToast({ title: '昵称不能为空', icon: 'none' });
      return;
    }
    // 按码点数，与服务端同一口径：一个 emoji 算一字，`length` 会算成两字。
    if ([...nickname].length > NICKNAME_MAX_LENGTH) {
      wx.showToast({ title: `昵称最多 ${NICKNAME_MAX_LENGTH} 字`, icon: 'none' });
      return;
    }
    if (nickname === this.data.view.nickname) return;
    await this.patch({ nickname });
  },

  /**
   * 换头像。选图与上传都在 `api/media.ts`（宽高要从 chooseMedia 原样带走，
   * Global Constraint 21），这里只把回执里的 url 存进资料。
   */
  async onChangeAvatar(): Promise<void> {
    const picked = await pickAndUploadImages(1).catch((err: Error) => {
      wx.showToast({ title: err.message || '上传失败', icon: 'none' });
      return null;
    });
    if (!picked || picked.canceled) return;
    if (picked.images.length === 0) {
      // 选了但被本地规则挡下（尺寸读不到 / 超过 5MB），要说一声。
      if (picked.skipped > 0) wx.showToast({ title: '这张图不合适，换一张', icon: 'none' });
      return;
    }
    await this.patch({ avatarUrl: picked.images[0].url });
  },

  async patch(dto: { nickname?: string; avatarUrl?: string | null }): Promise<void> {
    try {
      const profile = await updateProfile(dto);
      this.applyProfile(profile);
      wx.showToast({ title: '已更新', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '保存失败', icon: 'none' });
    }
  },

  applyProfile(profile: ProfileDto): void {
    this.setData({ view: buildProfileView(profile) });
  },

  /**
   * 资料与宠物清单一起取。两个请求并发：宠物清单不分页，两边都很小，
   * 串起来只会让首屏多等一个 RTT。
   */
  async load(): Promise<void> {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [profile, pets] = await Promise.all([fetchProfile(), fetchMyPets()]);
      this.setData({
        view: buildProfileView(profile),
        pets: pets.items.map((pet) => buildPetTile(pet)),
      });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
