import { fetchVenues } from '../../api/venues';
import { locationStore } from '../../store/location';
import { debounce } from '../../utils/debounce';
import { syncTabBar } from '../../utils/tab-bar';
import { CATEGORY_OPTIONS } from './venue-list-model';
import type { Venue } from '../../shared/types/index';

const SEARCH_DEBOUNCE_MS = 300;

Page({
  data: {
    categoryOptions: CATEGORY_OPTIONS,
    category: 'all',
    keyword: '',
    venues: [] as Venue[],
    loading: false,
    /** scroll-view 刷新态的受控位。刷完必须置回 false，否则刷新圈不收。 */
    refreshing: false,
  },

  /** 每敲一个字都发请求会把后端打满，也会让结果闪烁：停手 300ms 才搜。 */
  searchDebounced: debounce(() => undefined, SEARCH_DEBOUNCE_MS) as (kw: string) => void,

  onLoad() {
    this.searchDebounced = debounce((keyword: string) => {
      void this.load(keyword);
    }, SEARCH_DEBOUNCE_MS);
    void this.bootstrap();
  },

  onShow() {
    syncTabBar(this);
  },

  /**
   * 下拉刷新。挂在 scroll-view 的 `bindrefresherrefresh` 上而不是页面的
   * `onPullDownRefresh` —— Skyline 没有全局滚动，页面级回调没有载体。
   * `refreshing` 是受控状态位，取代 wx.stopPullDownRefresh()。
   */
  async onRefresh() {
    this.setData({ refreshing: true });
    try {
      await this.load(this.data.keyword);
    } finally {
      this.setData({ refreshing: false });
    }
  },

  onKeywordInput(e: WechatMiniprogram.Input) {
    const keyword = e.detail.value;
    this.setData({ keyword });
    this.searchDebounced(keyword);
  },

  onSearchConfirm() {
    void this.load(this.data.keyword);
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    void this.load('');
  },

  onCategoryChange(e: WechatMiniprogram.CustomEvent<{ selected: string }>) {
    this.setData({ category: e.detail.selected });
    void this.load(this.data.keyword);
  },

  onVenueTap(e: WechatMiniprogram.CustomEvent<{ poiId: string }>) {
    wx.navigateTo({ url: `/packages/venue/pages/detail/index?poiId=${e.detail.poiId}` });
  },

  /** 定位失败不阻塞：无坐标时后端按关键词/类目返回，只是不带距离。 */
  async bootstrap(): Promise<void> {
    await locationStore.ensure();
    await this.load('');
  },

  async load(keyword: string): Promise<void> {
    this.setData({ loading: true });
    const state = locationStore.state;
    const coords = state && state.mode === 'precise' ? state.coords : null;
    try {
      const venues = await fetchVenues({
        ...(keyword ? { keyword } : {}),
        category: this.data.category,
        ...(coords ? { lat: coords.latitude, lng: coords.longitude } : {}),
      });
      this.setData({ venues });
    } catch (err) {
      wx.showToast({ title: (err as Error).message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },
});
