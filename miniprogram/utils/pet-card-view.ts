import { API_BASE_URL } from '../config';
import { formatDistance, formatPetAge } from './format';
import { resolveImageUrl } from './image-url';
import type { PetGender, PetSummary } from '../shared/types/index';

/**
 * 瀑布流卡的展示数据：模板只渲染，不做任何计算。
 *
 * 住在 `utils/` 而不是广场页里，因为四个页面共用同一张卡 ——
 * 广场、关注列表、收藏列表、浏览历史。各写一份迟早在「距离怎么显示」
 * 这种细节上分叉（`shared/card-templates.wxml` 的 `pet-card-tpl` 是同一份模板，
 * 字段名对不上会渲染成空白）。
 */
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
 *
 * 图片地址在这里补全：本阶段服务端存的是相对路径（`/uploads/…`），
 * 直接塞给 `<image>` 会渲染成碎图。四个列表页共用这一份，所以补全也只补一次。
 */
export function buildFeedItem(pet: PetSummary, now?: Date, baseUrl?: string): FeedItem {
  const base = baseUrl ?? API_BASE_URL;
  return {
    id: pet.id,
    name: pet.name,
    breed: pet.breed,
    genderText: GENDER_TEXT[pet.gender] ?? '',
    ageText: formatPetAge(pet.birthDate, now).text,
    distanceText: formatDistance(pet.distanceMeters),
    personalityTags: pet.personalityTags,
    coverUrl: resolveImageUrl(pet.coverUrl, base),
    ownerNickname: pet.ownerNickname,
    ownerAvatarUrl: resolveImageUrl(pet.ownerAvatarUrl, base),
    // 宽高缺失时按正方形占位：0 会让 wf-list 的 height/width 失去意义。
    // 「我的宠物」里刚建好还没传照片的宠物走的就是这条（服务端回空串 + 0）。
    width: pet.coverWidth > 0 ? pet.coverWidth : 1,
    height: pet.coverHeight > 0 ? pet.coverHeight : 1,
  };
}
