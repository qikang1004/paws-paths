import { Inject, Injectable } from '@nestjs/common';
import { encodeGeohash } from '../common/geohash';
import { MAP_POI_CLIENT, type MapPoiClient, type MapPlace } from './poi-client';
import { POI_CACHE, type PoiCache } from './poi-cache';

const CACHE_TTL_SECONDS = 600;

/**
 * POI 三层降级：Redis 缓存 → 上游客户端 → null（上层再降级 venue_extras）。
 * 无 key（client 为 null）时直接返回 null，纯 venue_extras 模式。
 */
@Injectable()
export class PoiProxyService {
  constructor(
    @Inject(MAP_POI_CLIENT) private readonly client: MapPoiClient | null,
    @Inject(POI_CACHE) private readonly cache: PoiCache,
  ) {}

  async search(opts: {
    keyword: string;
    category: string;
    lat: number;
    lng: number;
  }): Promise<MapPlace[] | null> {
    if (!this.client) return null;

    // keyword 参与 key：不同搜索互不污染
    const key = `poi:gh:${encodeGeohash(opts.lat, opts.lng, 6)}:${opts.category}:${opts.keyword}`;

    const cached = await this.cache.get(key);
    if (cached != null) {
      try {
        return JSON.parse(cached) as MapPlace[];
      } catch {
        // 坏缓存当作未命中
      }
    }

    const places = await this.client.searchPlace(opts);
    if (places == null) return null;
    if (places.length > 0) {
      await this.cache.set(key, JSON.stringify(places), CACHE_TTL_SECONDS);
    }
    return places;
  }
}
