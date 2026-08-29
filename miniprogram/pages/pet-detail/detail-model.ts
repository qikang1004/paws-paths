import { formatDistance, formatPetAge } from '../../utils/format';
import type { PetDetail, PetGender } from '../../shared/types/index';

/** 相册项：wf-list 的 photo-tpl 只认这几个字段。 */
export interface PhotoItem {
  id: string;
  url: string;
  width: number;
  height: number;
  ratio: number;
  index: number;
}

export interface DetailView {
  id: string;
  name: string;
  metaText: string;
  ageText: string;
  distanceText: string;
  bio: string;
  bioShown: boolean;
  personalityTags: string[];
  ownerNickname: string;
  ownerAvatarUrl: string;
  ownerVerified: boolean;
  photos: PhotoItem[];
  album: PhotoItem[];
  urls: string[];
  /**
   * 关注态。服务端 `PetDetail.isFollowing` 必填、未登录一律 `false`，
   * 所以这里原样带过来，页面不写 `?? false`。
   */
  isFollowing: boolean;
  /**
   * 关注按钮显不显示。自己的宠物不显示 —— 关注自己在服务端是
   * `FOLLOW_SELF:42203`，让按钮出现再报错等于把一个必然失败的动作摆在用户面前。
   */
  showFollow: boolean;
  /** 按钮文案。放在视图里而不是 wxml 的三元表达式里：wxml 不做判断。 */
  followText: string;
}

const GENDER_TEXT: Record<PetGender, string> = {
  male: '雄',
  female: '雌',
  unknown: '',
};

function buildAlbum(pet: PetDetail): PhotoItem[] {
  return pet.photos.map((photo, index) => ({
    id: photo.id,
    url: photo.url,
    width: photo.width > 0 ? photo.width : 1,
    height: photo.height > 0 ? photo.height : 1,
    ratio: photo.width > 0 ? photo.height / photo.width : 1,
    index,
  }));
}

/** 关注按钮的两种文案。查表而不是三元表达式 —— 与别处的文案查表同款。 */
const FOLLOW_TEXT = { on: '已关注', off: '关注' } as const;

/** 关注态 → 按钮文案。导出给页面在就地翻转时复用，免得两处各写一份映射。 */
export function followTextOf(isFollowing: boolean): string {
  return isFollowing ? FOLLOW_TEXT.on : FOLLOW_TEXT.off;
}

/**
 * 详情 DTO → 页面展示数据。meta 行按「有值才进」拼接，
 * 性别未知时不会留下「布偶 ·  · 2 岁」这种空段。
 */
export function buildDetailView(pet: PetDetail, now?: Date): DetailView {
  const ageText = formatPetAge(pet.birthDate, now).text;
  const parts = [pet.breed, GENDER_TEXT[pet.gender] ?? '', ageText].filter((p) => p.length > 0);
  const album = buildAlbum(pet);
  return {
    id: pet.id,
    name: pet.name,
    metaText: parts.join(' · '),
    ageText,
    distanceText: formatDistance(pet.distanceMeters),
    bio: pet.bio,
    // 只有空白的简介等于没有简介，不占一行。
    bioShown: pet.bio.trim().length > 0,
    personalityTags: pet.personalityTags,
    ownerNickname: pet.owner.nickname,
    ownerAvatarUrl: pet.owner.avatarUrl ?? '',
    ownerVerified: pet.owner.ownerVerified,
    photos: album,
    album,
    urls: album.map((photo) => photo.url),
    isFollowing: pet.isFollowing,
    showFollow: !pet.isOwn,
    followText: followTextOf(pet.isFollowing),
  };
}
