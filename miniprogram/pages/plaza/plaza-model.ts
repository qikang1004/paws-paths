import { formatDistance, formatPetAge } from '../../utils/format';
import type { PetGender, PetSummary } from '../../shared/types/index';

/** 瀑布流卡的展示数据：模板只渲染，不做任何计算。 */
export interface FeedItem {
  id: string;
  name: string;
  breed: string;
  genderText: string;
  ageText: string;
  distanceText: string;
  personalityTags: string[];
  coverUrl: string;
  ownerNickname: string;
  ownerAvatarUrl: string;
  width: number;
  height: number;
}

const GENDER_TEXT: Record<PetGender, string> = {
  male: '雄',
  female: '雌',
  unknown: '',
};

/**
 * 接口 DTO → 卡片展示字段。年龄与距离都复用全应用统一的格式化函数，
 * 不在页面侧另写口径。
 */
export function buildFeedItem(pet: PetSummary, now?: Date): FeedItem {
  return {
    id: pet.id,
    name: pet.name,
    breed: pet.breed,
    genderText: GENDER_TEXT[pet.gender] ?? '',
    ageText: formatPetAge(pet.birthDate, now).text,
    distanceText: formatDistance(pet.distanceMeters),
    personalityTags: pet.personalityTags,
    coverUrl: pet.coverUrl,
    ownerNickname: pet.ownerNickname,
    ownerAvatarUrl: pet.ownerAvatarUrl ?? '',
    // 宽高缺失时按正方形占位：0 会让 wf-list 的 height/width 失去意义。
    width: pet.coverWidth > 0 ? pet.coverWidth : 1,
    height: pet.coverHeight > 0 ? pet.coverHeight : 1,
  };
}

export interface PageMeta {
  page: number;
  hasMore: boolean;
}

export interface MergedFeed extends PageMeta {
  items: FeedItem[];
}

/**
 * 追加下一页。按 id 去重：服务端分页在数据变动时可能把同一条带进两页，
 * 重复 key 会让 wx:key 报错并渲染错乱。第一页由调用方传空 prev 实现「替换」。
 */
export function mergePage(prev: FeedItem[], next: FeedItem[], meta: PageMeta): MergedFeed {
  const seen = new Set(prev.map((item) => item.id));
  const items = [...prev];
  for (const item of next) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, page: meta.page, hasMore: meta.hasMore };
}

/** 触底加载的闸门：有下一页且当前没有请求在飞。 */
export function shouldLoadMore(hasMore: boolean, loading: boolean): boolean {
  return hasMore && !loading;
}
