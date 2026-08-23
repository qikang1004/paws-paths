import { Inject, Injectable } from '@nestjs/common';
import { CATEGORY_LABELS, mapPoiCategory } from './poi-category.mapper';
import type { MapPlace } from './poi-client';
import type { PoiProxyService } from './poi-proxy.service';
import { FAVORITES_REPOSITORY, type FavoritesRepository } from './favorites.repository';
import {
  haversineMeters,
  VENUE_REPOSITORY,
  type VenueCategory,
  type VenueExtrasRow,
  type VenueRepository,
} from './venue.repository';

/** DI token：POI 代理（VenuesModule 内绑定，无 key 时其 search 恒返回 null）。 */
export const POI_PROXY = 'PoiProxyService';

/** DTO，与 packages/types 的 Venue 一致（含 lat/lng，Task 16 导航需要）。 */
export interface Venue {
  poiId: string;
  name: string;
  address: string;
  category: VenueCategory;
  categoryLabel: string;
  distanceMeters: number | null;
  rating: number | null;
  avgPrice: number | null;
  tags: string[];
  coverUrl: string | null;
  isFavorite: boolean;
  lat: number | null;
  lng: number | null;
}

export interface VenueSearchOptions {
  keyword?: string;
  category?: 'all' | VenueCategory;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  userId: string | null;
}

function fromExtras(row: VenueExtrasRow): Venue {
  const categoryLabel = CATEGORY_LABELS[row.category];
  return {
    poiId: row.poiId,
    name: row.name,
    address: row.address,
    category: row.category,
    categoryLabel,
    distanceMeters: row.distanceMeters,
    rating: row.rating,
    avgPrice: row.avgPrice,
    tags: row.tags.length > 0 ? row.tags : [categoryLabel],
    coverUrl: row.curatedPhoto,
    isFavorite: false,
    lat: row.lat,
    lng: row.lng,
  };
}

function fromPoi(place: MapPlace, lat: number, lng: number): Venue {
  const category = mapPoiCategory(place.category);
  const categoryLabel = CATEGORY_LABELS[category];
  return {
    poiId: place.poiId,
    name: place.name,
    address: place.address,
    category,
    categoryLabel,
    distanceMeters: haversineMeters(lat, lng, place.lat, place.lng),
    rating: null,
    avgPrice: null,
    tags: [categoryLabel],
    coverUrl: null,
    isFavorite: false,
    lat: place.lat,
    lng: place.lng,
  };
}

/**
 * 周边场所查询。降级链（spec §4.2）：POI 代理 → venue_extras。
 * POI 命中时用 extras 补 rating/avgPrice/tags/封面；POI 不可用（配额耗尽、
 * 无 key、无坐标）时整体走 extras。
 */
@Injectable()
export class VenuesService {
  constructor(
    @Inject(POI_PROXY) private readonly proxy: PoiProxyService | null,
    @Inject(VENUE_REPOSITORY) private readonly repo: VenueRepository,
    @Inject(FAVORITES_REPOSITORY) private readonly favs: FavoritesRepository,
  ) {}

  async search(opts: VenueSearchOptions): Promise<Venue[]> {
    const hasCoords = typeof opts.lat === 'number' && typeof opts.lng === 'number';
    const category = opts.category ?? 'all';

    let venues: Venue[] | null = null;
    if (hasCoords && this.proxy) {
      const places = await this.proxy.search({
        keyword: opts.keyword ?? '',
        category,
        lat: opts.lat as number,
        lng: opts.lng as number,
      });
      if (places != null) {
        venues = await this.enrichFromExtras(
          places.map((p) => fromPoi(p, opts.lat as number, opts.lng as number)),
        );
      }
    }

    if (venues == null) {
      const rows = await this.repo.search({
        keyword: opts.keyword,
        category,
        lat: opts.lat,
        lng: opts.lng,
        radiusMeters: opts.radiusMeters,
      });
      venues = rows.map(fromExtras);
    }

    return this.applyFavorites(venues, opts.userId);
  }

  async detail(poiId: string, userId: string | null): Promise<Venue | null> {
    const row = await this.repo.getById(poiId);
    if (!row) return null;
    const [venue] = await this.applyFavorites([fromExtras(row)], userId);
    return venue;
  }

  async setFavorite(
    poiId: string,
    userId: string,
    favorite: boolean,
  ): Promise<{ isFavorite: boolean }> {
    if (favorite) {
      await this.favs.add(userId, poiId);
    } else {
      await this.favs.remove(userId, poiId);
    }
    return { isFavorite: favorite };
  }

  /** POI 结果用 extras 覆盖运营字段（有 extras 才覆盖）。 */
  private async enrichFromExtras(venues: Venue[]): Promise<Venue[]> {
    return Promise.all(
      venues.map(async (v) => {
        const extras = await this.repo.getById(v.poiId);
        if (!extras) return v;
        const tags = extras.tags.length > 0 ? extras.tags : v.tags;
        return {
          ...v,
          rating: extras.rating,
          avgPrice: extras.avgPrice,
          tags,
          coverUrl: extras.curatedPhoto,
          lat: extras.lat ?? v.lat,
          lng: extras.lng ?? v.lng,
        };
      }),
    );
  }

  private async applyFavorites(venues: Venue[], userId: string | null): Promise<Venue[]> {
    if (!userId) return venues;
    const favorites = new Set(await this.favs.list(userId));
    return venues.map((v) => ({ ...v, isFavorite: favorites.has(v.poiId) }));
  }
}
