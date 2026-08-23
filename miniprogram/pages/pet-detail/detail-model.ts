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
  };
}
