import { fetchPets } from '../../api/pets';
import { breedsForSpecies } from '../../shared/filter';
import { locationStore } from '../../store/location';
import { syncTabBar } from '../../utils/tab-bar';
import { buildFeedItem, mergePage, shouldLoadMore, type FeedItem } from './plaza-model';
import type { FilterOption, PetFilter, PetSpecies } from '../../shared/types/index';

const PAGE_SIZE = 10;

const SPECIES_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部' },
  { value: 'dog', label: '犬' },
  { value: 'cat', label: '猫' },
  { value: 'other', label: '其他' },
];

/** 第二层选项前面永远挂一个「全部」，用户才能退回不限品种。 */
function breedOptionsFor(species: 'all' | PetSpecies): FilterOption[] {
  const breeds = breedsForSpecies(species);
  if (breeds.length === 0) return [];
  return [{ value: 'all', label: '全部' }, ...breeds.map((b) => ({ value: b, label: b }))];
}

Page({
  data: {
    speciesOptions: SPECIES_OPTIONS,
    filter: { species: 'all', breed: 'all' } as PetFilter,
    breedOptions: [] as FilterOption[],
    items: [] as FeedItem[],
    page: 0,
    hasMore: true,
    loading: false,
    modeText: '城市',
    canOpenSetting: false,
  },

  onLoad() {
    void this.bootstrap();
  },

  onShow() {
    syncTabBar(this);
  },

  onReachBottom() {
    if (!shouldLoadMore(this.data.hasMore, this.data.loading)) return;
    void this.loadPage(this.data.page + 1);
  },

  async onPullDownRefresh() {
    try {
      await this.loadPage(1);
    } finally {
      wx.stopPullDownRefresh();
    }
  },

  onFilterChange(e: WechatMiniprogram.CustomEvent<{ selected: string; subSelected: string }>) {
    const species = e.detail.selected as 'all' | PetSpecies;
    const filter: PetFilter = { species, breed: e.detail.subSelected };
    this.setData({ filter, breedOptions: breedOptionsFor(species) });
    void this.loadPage(1);
  },

  onPetTap(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    wx.navigateTo({ url: `/pages/pet-detail/index?id=${e.detail.id}` });
  },

  /** 用户在系统设置里开了定位后回来，清掉降级结果重新申请并刷新距离。 */
  onOpenSetting() {
    wx.openSetting({
      complete: () => {
        locationStore.reset();
        void this.bootstrap();
      },
    });
  },

  /** 定位失败不阻塞首屏：降级成城市模式照样出内容，只是不显示距离。 */
  async bootstrap(): Promise<void> {
    const state = await locationStore.ensure();
    this.setData({
      modeText: state.mode === 'precise' ? '精确' : '城市',
      canOpenSetting: state.mode !== 'precise',
    });
    await this.loadPage(1);
  },

  async loadPage(page: number): Promise<void> {
    if (this.data.loading) return;
    this.setData({ loading: true });
    const state = locationStore.state;
    const coords = state && state.mode === 'precise' ? state.coords : null;
    try {
      const res = await fetchPets({
        ...this.data.filter,
        page,
        pageSize: PAGE_SIZE,
        ...(coords ? { lat: coords.latitude, lng: coords.longitude } : {}),
      });
      const next = res.items.map((pet) => buildFeedItem(pet));
      // 第一页从空列表合并，等价于替换：筛选变了不能留着上一次的结果。
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
