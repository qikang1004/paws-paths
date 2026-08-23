import { formatDistance } from './format';
import type { Venue, VenueCategory } from '../shared/types/index';

export interface VenueView {
  poiId: string;
  name: string;
  address: string;
  category: VenueCategory;
  categoryLabel: string;
  distanceText: string;
  showRating: boolean;
  ratingText: string;
  showPrice: boolean;
  priceText: string;
  tags: string[];
  coverUrl: string;
  isFavorite: boolean;
  lat: number | null;
  lng: number | null;
}

/**
 * Venue DTO → 卡片展示字段。POI 分支没有 venue_extras 时评分/人均是 null，
 * 这里直接算出 showXxx 让 wxml 整行不渲染（spec §4.2 降级：卡片不留空洞）。
 *
 * 放在 utils 而不是某个页面目录下：列表页、venue-card 组件、分包里的场所详情页
 * 共用同一套口径，组件不该反向依赖页面。
 */
export function buildVenueView(venue: Venue): VenueView {
  // rating 0 是「没有评分」而不是「评分零分」：POI 源没打分时就给 0。
  const showRating = venue.rating != null && venue.rating > 0;
  const showPrice = venue.avgPrice != null && venue.avgPrice > 0;
  return {
    poiId: venue.poiId,
    name: venue.name,
    address: venue.address,
    category: venue.category,
    categoryLabel: venue.categoryLabel,
    distanceText: formatDistance(venue.distanceMeters),
    showRating,
    ratingText: showRating ? `★ ${venue.rating}` : '',
    showPrice,
    priceText: showPrice ? `人均 ¥${venue.avgPrice}` : '',
    // 没有 extras 标签时至少显示类目，标签区不空着。
    tags: venue.tags.length > 0 ? venue.tags : [venue.categoryLabel],
    coverUrl: venue.coverUrl ?? '',
    isFavorite: venue.isFavorite,
    lat: venue.lat,
    lng: venue.lng,
  };
}
