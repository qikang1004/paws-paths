import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

/** DI token：业务侧依赖窄接口，测试注入内存实现（与 PET_REPOSITORY 同款）。 */
export const VENUE_REPOSITORY = 'VenueRepository';

export type VenueCategory = 'hospital' | 'shop' | 'grooming' | 'park' | 'cafe' | 'other';

/** 域记录（camelCase），与 packages/types 的 Venue 字段一一对应（含 lat/lng，导航需要）。 */
export interface VenueExtrasRow {
  poiId: string;
  name: string;
  address: string;
  category: VenueCategory;
  rating: number | null;
  avgPrice: number | null;
  tags: string[];
  curatedPhoto: string | null;
  distanceMeters: number | null;
  lat: number | null;
  lng: number | null;
}

export interface VenueSearchQuery {
  keyword?: string;
  category?: 'all' | VenueCategory;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}

export interface VenueRepository {
  search(q: VenueSearchQuery): Promise<VenueExtrasRow[]>;
  getById(poiId: string): Promise<VenueExtrasRow | null>;
}

/** 球面距离（米），与 PostGIS geography ST_Distance 的球面语义一致（pet.repository 同款）。 */
export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** 演示种子（与 server/src/database/seed.sql 的 venue_extras 一一对应）：10 家。 */
interface VenueSeedRecord {
  poiId: string;
  name: string;
  address: string;
  category: VenueCategory;
  rating: number | null;
  avgPrice: number | null;
  tags: string[];
  curatedPhoto: string | null;
  lat: number;
  lng: number;
}

const VENUE_SEED: VenueSeedRecord[] = [
  { poiId: 'v-1', name: '宠福康宠物医院', address: '朝阳区望京西路 48 号', category: 'hospital', rating: 4.8, avgPrice: 320, tags: ['夜间急诊', '猫友好'], curatedPhoto: 'https://picsum.photos/seed/venue-v1/800/500', lat: 39.905, lng: 116.405 },
  { poiId: 'v-2', name: '贝恩宠物医院', address: '朝阳区广顺北大街 33 号', category: 'hospital', rating: 4.5, avgPrice: 280, tags: ['犬猫分区', '住院部'], curatedPhoto: 'https://picsum.photos/seed/venue-v2/800/500', lat: 39.912, lng: 116.402 },
  { poiId: 'v-3', name: '萌宠之家宠物用品店', address: '朝阳区望京街 9 号', category: 'shop', rating: 4.6, avgPrice: 150, tags: ['进口粮', '美容工具'], curatedPhoto: 'https://picsum.photos/seed/venue-v3/800/500', lat: 39.901, lng: 116.409 },
  { poiId: 'v-4', name: '汪汪星球宠物店', address: '朝阳区阜通东大街 12 号', category: 'shop', rating: 4.7, avgPrice: 180, tags: ['活体选购', '寄养'], curatedPhoto: 'https://picsum.photos/seed/venue-v4/800/500', lat: 39.907, lng: 116.414 },
  { poiId: 'v-5', name: '靓靓宠物美容', address: '朝阳区望京西路 27 号', category: 'grooming', rating: 4.9, avgPrice: 120, tags: ['造型设计', 'SPA'], curatedPhoto: 'https://picsum.photos/seed/venue-v5/800/500', lat: 39.903, lng: 116.406 },
  { poiId: 'v-6', name: '爪爪洗澡屋', address: '朝阳区湖光中街 5 号', category: 'grooming', rating: 4.4, avgPrice: 80, tags: ['洗护', '修剪'], curatedPhoto: 'https://picsum.photos/seed/venue-v6/800/500', lat: 39.91, lng: 116.408 },
  { poiId: 'v-7', name: '朝阳公园宠物区', address: '朝阳区朝阳公园南路 1 号', category: 'park', rating: 4.6, avgPrice: 0, tags: ['大草坪', '宠物厕所'], curatedPhoto: 'https://picsum.photos/seed/venue-v7/800/500', lat: 39.908, lng: 116.416 },
  { poiId: 'v-8', name: '奥森宠物公园', address: '朝阳区科荟路 33 号', category: 'park', rating: 4.8, avgPrice: 0, tags: ['围栏区', '饮水点'], curatedPhoto: 'https://picsum.photos/seed/venue-v8/800/500', lat: 39.915, lng: 116.412 },
  { poiId: 'v-9', name: '有猫咖啡', address: '朝阳区望京西路 19 号', category: 'cafe', rating: 4.7, avgPrice: 45, tags: ['猫咪互动', '咖啡'], curatedPhoto: 'https://picsum.photos/seed/venue-v9/800/500', lat: 39.902, lng: 116.403 },
  { poiId: 'v-10', name: '萌宠主题餐厅', address: '朝阳区阜通西大街 8 号', category: 'cafe', rating: 4.3, avgPrice: 88, tags: ['宠物餐', '人宠同食'], curatedPhoto: 'https://picsum.photos/seed/venue-v10/800/500', lat: 39.906, lng: 116.411 },
];

function toRow(seed: VenueSeedRecord, distanceMeters: number | null): VenueExtrasRow {
  return {
    poiId: seed.poiId,
    name: seed.name,
    address: seed.address,
    category: seed.category,
    rating: seed.rating,
    avgPrice: seed.avgPrice,
    tags: seed.tags,
    curatedPhoto: seed.curatedPhoto,
    distanceMeters,
    lat: seed.lat,
    lng: seed.lng,
  };
}

function matchesKeyword(row: VenueExtrasRow, keyword?: string): boolean {
  if (keyword == null || keyword === '') return true;
  const needle = keyword.toLowerCase();
  return row.name.toLowerCase().includes(needle) || row.address.toLowerCase().includes(needle);
}

@Injectable()
export class InMemoryVenueRepository implements VenueRepository {
  async search(q: VenueSearchQuery): Promise<VenueExtrasRow[]> {
    const category = q.category ?? 'all';
    const hasCoords = typeof q.lat === 'number' && typeof q.lng === 'number';

    const filtered = VENUE_SEED.filter((v) => {
      if (category !== 'all' && v.category !== category) return false;
      return true;
    });

    let rows: VenueExtrasRow[];
    if (hasCoords) {
      const lat = q.lat as number;
      const lng = q.lng as number;
      rows = filtered
        .map((v) => toRow(v, haversineMeters(lat, lng, v.lat, v.lng)))
        .filter(
          (r) => q.radiusMeters == null || (r.distanceMeters as number) <= q.radiusMeters,
        )
        .filter((r) => matchesKeyword(r, q.keyword))
        .sort((a, b) => (a.distanceMeters as number) - (b.distanceMeters as number));
    } else {
      rows = filtered
        .map((v) => toRow(v, null))
        .filter((r) => matchesKeyword(r, q.keyword))
        .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    }
    return rows;
  }

  async getById(poiId: string): Promise<VenueExtrasRow | null> {
    const seed = VENUE_SEED.find((v) => v.poiId === poiId);
    return seed ? toRow(seed, null) : null;
  }
}

/** PostgreSQL + PostGIS 实现（DATABASE_URL 存在时经 VenuesModule 工厂注入）。SQL 见计划附录 D。 */
export class PostgresVenueRepository implements VenueRepository {
  constructor(private readonly pool: Pool) {}

  async search(q: VenueSearchQuery): Promise<VenueExtrasRow[]> {
    const hasCoords = typeof q.lat === 'number' && typeof q.lng === 'number';
    const keyword = q.keyword ?? null;
    const category = q.category ?? 'all';
    const radius = q.radiusMeters ?? null;

    if (hasCoords) {
      const res = await this.pool.query<VenueExtrasRow>(
        `
        SELECT poi_id AS "poiId", name, address, category, rating::float8 AS rating,
               avg_price AS "avgPrice", tags, curated_photo AS "curatedPhoto",
               ST_X(location::geometry) AS lat, ST_Y(location::geometry) AS lng,
               ST_Distance(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters"
        FROM venue_extras
        WHERE ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR address ILIKE '%' || $3 || '%')
          AND ($4 = 'all' OR category = $4)
          AND ($5::float8 IS NULL OR ST_DWithin(location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5))
        ORDER BY "distanceMeters" ASC
        `,
        [q.lng, q.lat, keyword, category, radius],
      );
      return res.rows;
    }

    const res = await this.pool.query<VenueExtrasRow>(
      `
      SELECT poi_id AS "poiId", name, address, category, rating::float8 AS rating,
             avg_price AS "avgPrice", tags, curated_photo AS "curatedPhoto",
             ST_X(location::geometry) AS lat, ST_Y(location::geometry) AS lng,
             null::float8 AS "distanceMeters"
      FROM venue_extras
      WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR address ILIKE '%' || $1 || '%')
        AND ($2 = 'all' OR category = $2)
      ORDER BY name ASC
      `,
      [keyword, category],
    );
    return res.rows;
  }

  async getById(poiId: string): Promise<VenueExtrasRow | null> {
    const res = await this.pool.query<VenueExtrasRow>(
      `
      SELECT poi_id AS "poiId", name, address, category, rating::float8 AS rating,
             avg_price AS "avgPrice", tags, curated_photo AS "curatedPhoto",
             ST_X(location::geometry) AS lat, ST_Y(location::geometry) AS lng,
             null::float8 AS "distanceMeters"
      FROM venue_extras
      WHERE poi_id = $1
      `,
      [poiId],
    );
    return res.rows[0] ?? null;
  }
}
