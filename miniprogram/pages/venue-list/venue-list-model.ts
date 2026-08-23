import type { FilterOption } from '../../shared/types/index';

/** 类目筛选项，与服务端 VenueCategory 枚举对齐（other 不单独给入口）。 */
export const CATEGORY_OPTIONS: FilterOption[] = [
  { value: 'all', label: '全部' },
  { value: 'hospital', label: '宠物医院' },
  { value: 'shop', label: '宠物店' },
  { value: 'grooming', label: '美容洗护' },
  { value: 'park', label: '宠物公园' },
  { value: 'cafe', label: '宠物友好' },
];

// 展示字段口径放在 utils/venue-view：列表页、venue-card、分包详情页共用。
export { buildVenueView, type VenueView } from '../../utils/venue-view';
