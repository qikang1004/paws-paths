import type {
  PetDetail,
  PetFilter,
  PetListResponse,
  PetPatchDto,
  PetPhoto,
  PetPhotoUploadDto,
  PetUpsertDto,
} from '../shared/types/index';
import { api } from './client';
import type { ApiClient } from './request';

export interface FetchPetsParams extends PetFilter {
  page: number;
  pageSize: number;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}

/** client 可注入：页面用默认单例，测试注入 FakeWx 驱动的 ApiClient。 */
export async function fetchPets(
  params: FetchPetsParams,
  client: ApiClient = api,
): Promise<PetListResponse> {
  return client.call<PetListResponse>('/pets', { data: params });
}

export async function fetchPetDetail(
  id: string,
  client: ApiClient = api,
  lat?: number,
  lng?: number,
): Promise<PetDetail> {
  return client.call<PetDetail>(`/pets/${id}`, { data: { lat, lng } });
}

/** 建号只要名字和物种：那一刻主人手上通常也只有这两样。 */
export async function createPet(
  body: PetUpsertDto,
  client: ApiClient = api,
): Promise<{ id: string }> {
  return client.call<{ id: string }>('/pets', { method: 'POST', data: body });
}

/**
 * 改资料。字段全可省，省略表示不动这一项，但**一个都不给会 422** ——
 * 静默 200 只会让「字段名写错」这种 bug 更难查。
 *
 * 同 `updateProfile`：动词只能是 PUT，`wx.request` 发不出 PATCH。
 */
export async function updatePet(
  id: string,
  patch: PetPatchDto,
  client: ApiClient = api,
): Promise<PetDetail> {
  return client.call<PetDetail>(`/pets/${id}`, { method: 'PUT', data: patch });
}

/** 硬删。服务端在一个事务里连带清照片、收藏、浏览历史。 */
export async function deletePet(
  id: string,
  client: ApiClient = api,
): Promise<{ deleted: boolean }> {
  return client.call<{ deleted: boolean }>(`/pets/${id}`, { method: 'DELETE' });
}

/** 加照片。宽高必传（Global Constraint 21），第一张自动成为封面。 */
export async function addPetPhoto(
  petId: string,
  photo: PetPhotoUploadDto,
  client: ApiClient = api,
): Promise<PetPhoto> {
  return client.call<PetPhoto>(`/pets/${petId}/photos`, { method: 'POST', data: photo });
}

/** 删照片。删掉的正好是封面时，服务端在同一条语句里把指针顶给下一张。 */
export async function removePetPhoto(
  petId: string,
  photoId: string,
  client: ApiClient = api,
): Promise<{ deleted: boolean }> {
  return client.call<{ deleted: boolean }>(`/pets/${petId}/photos/${photoId}`, {
    method: 'DELETE',
  });
}

/** 收藏心标（原型 `_2`）。与关注是两件事：关注进「我的关注」，收藏进「我的收藏」。 */
export interface FavoriteState {
  isFavorite: boolean;
}

export async function favoritePet(
  petId: string,
  client: ApiClient = api,
): Promise<FavoriteState> {
  return client.call<FavoriteState>(`/pets/${petId}/favorite`, { method: 'POST' });
}

export async function unfavoritePet(
  petId: string,
  client: ApiClient = api,
): Promise<FavoriteState> {
  return client.call<FavoriteState>(`/pets/${petId}/favorite`, { method: 'DELETE' });
}
