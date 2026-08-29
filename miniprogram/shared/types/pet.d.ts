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
    /**
     * 这只宠物是不是**看的人自己的**。未登录一律 `false`。
     *
     * 客户端拿它决定「关注按钮出不出现」：关注自己的宠物在服务端是
     * `FOLLOW_SELF:42203`，让按钮出现再报错等于把一个必然失败的动作摆在用户面前。
     *
     * 下发的是这个**布尔值**而不是 `ownerId`：主人的用户 id 不该出现在公开的详情
     * 响应里（`PetRow` 也刻意不带它），而客户端要判的本来就只是「是不是我」。
     */
    isOwn: boolean;
}
export interface PetListResponse {
    items: PetSummary[];
    hasMore: boolean;
    page: number;
}
/**
 * `GET /me/pets` 的响应 —— 「我的宠物」。
 *
 * **刻意不分页**：一个人的宠物只有几只，而两个消费者（发布页选宠物、
 * 「我的动态」按宠物取动态）都需要完整清单才能工作，分页只会逼它们
 * 自己拼页。所以这里没有 `hasMore` / `page`。
 *
 * 与 {@link PetListResponse} 的另一处区别是**不筛封面**：刚建好还没传照片的
 * 宠物进不了广场瀑布流，但必须出现在「我的宠物」里 —— 否则主人没有入口
 * 进去传第一张照片。
 */
export interface MyPetListResponse {
    items: PetSummary[];
}
