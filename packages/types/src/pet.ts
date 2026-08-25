export type PetSpecies = 'dog' | 'cat' | 'other';
export type PetGender = 'male' | 'female' | 'unknown';

export interface PetSummary {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  birthDate: string;
  coverUrl: string;
  coverWidth: number;
  coverHeight: number;
  personalityTags: string[];
  distanceMeters: number | null;
  ownerNickname: string;
  ownerAvatarUrl: string | null;
  ownerVerified: boolean;
  /**
   * 当前登录用户是否已关注这只宠物。未登录恒为 `false`。
   * 刻意做成必填而不是可选：服务端一定给值，可选会让页面到处写 `?? false`。
   */
  isFollowing: boolean;
}

export interface PetPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PetDetail {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  birthDate: string;
  bio: string;
  personalityTags: string[];
  distanceMeters: number | null;
  owner: { nickname: string; avatarUrl: string | null; ownerVerified: boolean };
  photos: PetPhoto[];
  /** 同 {@link PetSummary.isFollowing}。 */
  isFollowing: boolean;
}

export interface PetListResponse {
  items: PetSummary[];
  hasMore: boolean;
  page: number;
}
