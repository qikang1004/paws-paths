import type { VenueCategory } from './venue.repository';

/**
 * 腾讯 POI category 文本 → 自有类目。规则按优先级排列，命中即返回。
 * 注意：shop 规则不含裸「店」——「神秘小店」这类泛称按 other 处理
 * （计划测试对此有明确断言），只匹配明确的购物类词。
 */
export function mapPoiCategory(raw: string): VenueCategory {
  if (/医院|clinic/i.test(raw)) return 'hospital';
  if (/宠物店|超市|商场|用品|食品|粮/i.test(raw)) return 'shop';
  if (/美容|洗澡|洗护|spa|造型/i.test(raw)) return 'grooming';
  if (/公园|景区|绿地|广场|草坪/i.test(raw)) return 'park';
  if (/咖啡|cafe|餐厅|饭店|餐饮|宠物友好/i.test(raw)) return 'cafe';
  return 'other';
}

export const CATEGORY_LABELS: Record<VenueCategory, string> = {
  hospital: '宠物医院',
  shop: '宠物店',
  grooming: '美容洗护',
  park: '宠物公园',
  cafe: '宠物友好',
  other: '其他',
};
