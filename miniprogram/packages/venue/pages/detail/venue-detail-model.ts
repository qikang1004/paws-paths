import { buildVenueView, type VenueView } from '../../../../utils/venue-view';
import type { Venue } from '../../../../shared/types/index';

export interface VenueDetailView extends VenueView {
  showFavorite: boolean;
  showNavigation: boolean;
}

/** 只有两个坐标都在才拉地图：缺一个就打不开正确位置，宁可不给入口。 */
export function canNavigate(venue: Venue | null): boolean {
  return venue != null && venue.lat != null && venue.lng != null;
}

/**
 * 详情展示数据。降级字段直接复用卡片那套 buildVenueView，
 * 列表与详情不会出现两种「人均」写法。
 */
export function detailView(venue: Venue): VenueDetailView {
  return {
    ...buildVenueView(venue),
    // 收藏入口恒在：未登录时 api 层会先静默登录，失败再 toast。
    showFavorite: true,
    showNavigation: canNavigate(venue),
  };
}
