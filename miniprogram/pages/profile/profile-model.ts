import { API_BASE_URL } from '../../config';
import { resolveImageUrl } from '../../utils/image-url';
import type { PetSummary, ProfileDto } from '../../shared/types/index';

/**
 * 个人中心的展示装配。页面只负责取数与跳转，wxml 只渲染 —— 计数怎么排、
 * 入口指向哪个分包页，全在这里定死一份。
 */

/** 昵称上限，与服务端的 20 个码点对齐（一个 emoji 算一字）。改这里也要改服务端。 */
export const NICKNAME_MAX_LENGTH = 20;

export interface CountView {
  key: string;
  label: string;
  value: number;
}

export interface ProfileView {
  nickname: string;
  /** 已补全的头像地址；空串表示没有头像，模板据此画默认图。 */
  avatarUrl: string;
  showVerified: boolean;
  counts: CountView[];
}

/**
 * 资料 → 视图。`profile` 为 `null` 表示还没取回来：这时也要能渲染出骨架，
 * 不然首帧会是一整块空白。
 */
export function buildProfileView(profile: ProfileDto | null, baseUrl?: string): ProfileView {
  const base = baseUrl ?? API_BASE_URL;
  return {
    nickname: profile?.nickname ?? '',
    avatarUrl: resolveImageUrl(profile?.avatarUrl, base),
    // 认证与否只听服务端的 `isVerifiedOwner`，客户端不从别的字段推。
    showVerified: profile?.isVerifiedOwner ?? false,
    counts: [
      { key: 'pets', label: '宠物', value: profile?.petCount ?? 0 },
      { key: 'following', label: '关注', value: profile?.followingCount ?? 0 },
      { key: 'favorites', label: '收藏', value: profile?.favoriteCount ?? 0 },
    ],
  };
}

export interface EntryView {
  key: string;
  label: string;
  url: string;
}

/** 四个入口。路径与 `app.json` 的 `packages/profile` 分包声明一一对应。 */
export const PROFILE_ENTRIES: EntryView[] = [
  { key: 'posts', label: '我的动态', url: '/packages/profile/pages/my-posts/index' },
  { key: 'following', label: '我的关注', url: '/packages/profile/pages/following/index' },
  { key: 'favorites', label: '我的收藏', url: '/packages/profile/pages/favorites/index' },
  { key: 'history', label: '浏览历史', url: '/packages/profile/pages/history/index' },
];

export interface PetTile {
  id: string;
  name: string;
  /** 空串表示还没传照片 —— `GET /me/pets` 不筛封面，这种宠物必须能点进去补图。 */
  coverUrl: string;
  url: string;
}

export function buildPetTile(pet: PetSummary, baseUrl?: string): PetTile {
  return {
    id: pet.id,
    name: pet.name,
    coverUrl: resolveImageUrl(pet.coverUrl, baseUrl ?? API_BASE_URL),
    url: `/packages/profile/pages/pet-edit/index?id=${pet.id}`,
  };
}
