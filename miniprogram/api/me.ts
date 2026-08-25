import type {
  FavoriteItemDto,
  ProfileDto,
  ProfilePatchDto,
  ViewHistoryItemDto,
} from '../shared/types/index';
import { api } from './client';
import type { PagedResponse, PageParams } from './paged';
import type { ApiClient } from './request';

/** 个人中心资料。三个计数一起回来，页面一次请求就能画完。 */
export async function fetchProfile(client: ApiClient = api): Promise<ProfileDto> {
  return client.call<ProfileDto>('/me');
}

/**
 * 改资料。**把 patch 原样发出去**，不要在这里重建对象。
 *
 * 服务端按 `'avatarUrl' in body` 区分「不动头像」与「清空头像」，
 * 一旦这里写成 `{ avatarUrl: patch.avatarUrl ?? undefined }` 之类，
 * `null` 就会被抹成「没给」—— 清空头像永远生效不了。
 *
 * 动词是 `PUT` 而不是语义更贴的 `PATCH`：`wx.request` 的 method 白名单里
 * 压根没有 PATCH（只有 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT），
 * 小程序端发不出去。服务端为此给 `/me` 同时挂了 PATCH 与 PUT 两个动词，
 * 共用一份局部更新实现 —— 这里走 PUT，语义仍是「只改给了的字段」。
 */
export async function updateProfile(
  patch: ProfilePatchDto,
  client: ApiClient = api,
): Promise<ProfileDto> {
  return client.call<ProfileDto>('/me', { method: 'PUT', data: patch });
}

export async function fetchHistory(
  params: PageParams,
  client: ApiClient = api,
): Promise<PagedResponse<ViewHistoryItemDto>> {
  return client.call<PagedResponse<ViewHistoryItemDto>>('/me/history', { data: params });
}

/** 收藏列表是 pet/venue 混排，条目形状与浏览历史刻意一致（只有时间字段名不同）。 */
export async function fetchFavorites(
  params: PageParams,
  client: ApiClient = api,
): Promise<PagedResponse<FavoriteItemDto>> {
  return client.call<PagedResponse<FavoriteItemDto>>('/me/favorites', { data: params });
}
