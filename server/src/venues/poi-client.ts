/** DI token：POI 上游客户端。无 TENCENT_MAP_KEY 时绑定 null（纯 venue_extras 模式）。 */
export const MAP_POI_CLIENT = 'MapPoiClient';

export interface MapPlace {
  poiId: string;
  name: string;
  address: string;
  category: string;
  lat: number;
  lng: number;
}

export interface MapPoiClient {
  searchPlace(opts: {
    keyword: string;
    category: string;
    lat: number;
    lng: number;
    radiusMeters?: number;
  }): Promise<MapPlace[] | null>;
}

/**
 * 腾讯位置服务 POI 搜索客户端。任何失败（HTTP 非 2xx、status 非 0、
 * 网络异常）都返回 null —— 由上层降级到 venue_extras，绝不向上抛。
 */
export class TencentPoiClient implements MapPoiClient {
  constructor(private readonly key: string) {}

  async searchPlace(opts: {
    keyword: string;
    category: string;
    lat: number;
    lng: number;
    radiusMeters?: number;
  }): Promise<MapPlace[] | null> {
    try {
      const url =
        'https://apis.map.qq.com/ws/place/v1/search?' +
        new URLSearchParams({
          key: this.key,
          keyword: opts.keyword,
          category: opts.category,
          boundary: `nearby(${opts.lat},${opts.lng},${opts.radiusMeters ?? 3000})`,
          page_size: '20',
        });
      const res = await fetch(url);
      if (!res.ok) return null;
      const json = (await res.json()) as { status?: number; data?: unknown[] };
      if (json.status !== 0) return null;
      return (json.data ?? []).map((item) => {
        const it = item as {
          id?: string;
          title?: string;
          address?: string;
          category?: string;
          location?: { lat?: number; lng?: number };
        };
        return {
          poiId: it.id ?? '',
          name: it.title ?? '',
          address: it.address ?? '',
          category: it.category ?? '',
          lat: it.location?.lat ?? 0,
          lng: it.location?.lng ?? 0,
        };
      });
    } catch {
      return null;
    }
  }
}
