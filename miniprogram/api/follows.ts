import type { FollowDto } from '../shared/types/index';
import { api } from './client';
import type { PagedResponse, PageParams } from './paged';
import type { ApiClient } from './request';

/**
 * 关注。三个端点的路径分属两处，是服务端有意的划分：
 *
 * - 关注/取关挂在宠物上（`POST|DELETE /pets/:id/follow`，`PetsController`）——
 *   动作的对象是那只宠物。
 * - 「我关注了谁」挂在 `/me/following` —— 那是当前用户自己的数据，
 *   与 `/me/history`、`/me/favorites` 同一组鉴权。
 *
 * 路径归宠物与 `/me`，语义都归关注，所以客户端把三个包在同一个文件里。
 */

/** 关注开关的回执。重复关注也返回 200 + `true`（服务端幂等），不是 409。 */
export interface FollowState {
  isFollowing: boolean;
}

export async function followPet(petId: string, client: ApiClient = api): Promise<FollowState> {
  return client.call<FollowState>(`/pets/${petId}/follow`, { method: 'POST' });
}

export async function unfollowPet(petId: string, client: ApiClient = api): Promise<FollowState> {
  return client.call<FollowState>(`/pets/${petId}/follow`, { method: 'DELETE' });
}

export async function fetchFollowing(
  params: PageParams,
  client: ApiClient = api,
): Promise<PagedResponse<FollowDto>> {
  return client.call<PagedResponse<FollowDto>>('/me/following', { data: params });
}
