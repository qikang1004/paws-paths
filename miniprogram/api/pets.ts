import type { PetDetail, PetFilter, PetListResponse } from '../shared/types/index';
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
