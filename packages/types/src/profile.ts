import type { PetGender, PetSpecies } from './pet';

/**
 * 个人中心资料。三个计数一起下发，让个人中心一次请求画完页面。
 * 刻意不含 `openid`、手机号等敏感字段 —— 它们不下发到客户端。
 */
export interface ProfileDto {
  nickname: string;
  avatarUrl: string | null;
  isVerifiedOwner: boolean;
  petCount: number;
  followingCount: number;
  favoriteCount: number;
}

/**
 * `PATCH /me` 的入参。两个字段都可省 —— 省略表示不动这一项。
 * `avatarUrl: null` 是「清空头像」的显式表达，与省略字段不是一回事。
 * 昵称按码点数最多 20 字（一个 emoji 算一字），首尾空格会被服务端裁掉。
 */
export interface ProfilePatchDto {
  nickname?: string;
  avatarUrl?: string | null;
}

/**
 * 宠物新建/修改入参。创建时 `name` 与 `species` 必填，其余可省（走库里的默认值）。
 * 刻意不含 `id`：更新目标由 `PATCH /pets/:id` 的路径参数决定，避免客户端
 * 在 body 里塞别人的宠物 id 绕过归属校验。
 */
export interface PetUpsertDto {
  name: string;
  species: PetSpecies;
  breed?: string;
  gender?: PetGender;
  /** `YYYY-MM-DD`。 */
  birthDate?: string;
  bio?: string;
  personalityTags?: string[];
  lat?: number;
  lng?: number;
}
