// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
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
    owner: {
        nickname: string;
        avatarUrl: string | null;
        ownerVerified: boolean;
    };
    photos: PetPhoto[];
    /** 同 {@link PetSummary.isFollowing}。 */
    isFollowing: boolean;
    /**
     * 是否已收藏（原型 `_2` 的心标）。只在详情页出现 —— 广场页的卡片上只有关注，
     * 所以 {@link PetSummary} 刻意没有这个字段。
     *
     * 与 `isFollowing` 同款：必填、未登录一律 `false`，免得页面到处写 `?? false`。
     */
    isFavorite: boolean;
}
export interface PetListResponse {
    items: PetSummary[];
    hasMore: boolean;
    page: number;
}
