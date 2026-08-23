import type { Venue } from '../shared/types/index';
import { api } from './client';
import type { ApiClient } from './request';

export interface FetchVenuesParams {
  keyword?: string;
  category?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}

/** client 可注入：页面用默认单例，测试注入 FakeWx 驱动的 ApiClient。 */
export async function fetchVenues(
  params: FetchVenuesParams,
  client: ApiClient = api,
): Promise<Venue[]> {
  return client.call<Venue[]>('/venues', { data: params });
}

export async function fetchVenueDetail(poiId: string, client: ApiClient = api): Promise<Venue> {
  return client.call<Venue>(`/venues/${poiId}`);
}

export async function addFavorite(
  poiId: string,
  client: ApiClient = api,
): Promise<{ isFavorite: boolean }> {
  return client.call<{ isFavorite: boolean }>(`/venues/${poiId}/favorite`, { method: 'POST' });
}

export async function removeFavorite(
  poiId: string,
  client: ApiClient = api,
): Promise<{ isFavorite: boolean }> {
  return client.call<{ isFavorite: boolean }>(`/venues/${poiId}/favorite`, { method: 'DELETE' });
}
