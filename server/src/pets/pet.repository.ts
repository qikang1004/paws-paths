import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

/** DI token：业务侧依赖窄接口，测试注入内存实现（与 USER_REPOSITORY 同款）。 */
export const PET_REPOSITORY = 'PetRepository';

export type PetSpecies = 'dog' | 'cat' | 'other';
export type PetGender = 'male' | 'female' | 'unknown';

export interface PetFilter {
  species: 'all' | PetSpecies;
  breed: string; // 'all' 或具体品种
}

export interface PetQuery {
  filter: PetFilter;
  page: number;
  pageSize: number;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
}

/** 域记录（camelCase），与 packages/types 的 PetSummary 字段一一对应。 */
export interface PetRow {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  birthDate: string;
  personalityTags: string[];
  bio: string;
  distanceMeters: number | null;
  coverUrl: string;
  coverWidth: number;
  coverHeight: number;
  ownerNickname: string;
  ownerAvatarUrl: string | null;
  ownerVerified: boolean;
}

export interface PetPhotoRow {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PetRepository {
  list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }>;
  getById(id: string, coords?: { lat: number; lng: number }): Promise<{ pet: PetRow; photos: PetPhotoRow[] } | null>;
}

/** 球面距离（米），与 PostGIS geography ST_Distance 的球面语义一致。 */
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

/** 演示种子（与 server/src/database/seed.sql 一一对应）：8 只宠物 + 17 张照片。 */
interface PetSeedRecord {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  birthDate: string;
  personalityTags: string[];
  bio: string;
  lat: number;
  lng: number;
  lastActiveAt: string;
  coverUrl: string;
  coverWidth: number;
  coverHeight: number;
  ownerNickname: string;
  ownerAvatarUrl: string | null;
  ownerVerified: boolean;
}

interface PhotoSeedRecord {
  id: string;
  petId: string;
  url: string;
  width: number;
  height: number;
  sortOrder: number;
}

const PET_SEED: PetSeedRecord[] = [
  { id: 'p-1', name: '大黄', species: 'dog', breed: '金毛', gender: 'male', birthDate: '2022-05-01', personalityTags: ['黏人', '爱玩水'], bio: '爱玩水的暖男，见到谁都摇尾巴。', lat: 39.906, lng: 116.404, lastActiveAt: '2026-08-20T10:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-huang/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '小陈', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u1/120/120', ownerVerified: true },
  { id: 'p-2', name: '奶昔', species: 'cat', breed: '布偶', gender: 'female', birthDate: '2024-02-14', personalityTags: ['温柔', '爱睡觉'], bio: '蓝眼睛的小公主，喜欢被摸下巴。', lat: 39.902, lng: 116.41, lastActiveAt: '2026-08-21T08:30:00Z', coverUrl: 'https://picsum.photos/seed/paws-naixi/800/600', coverWidth: 800, coverHeight: 600, ownerNickname: '阿喵', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u2/120/120', ownerVerified: true },
  { id: 'p-3', name: '可乐', species: 'dog', breed: '柯基', gender: 'male', birthDate: '2023-08-20', personalityTags: ['活泼', '贪吃'], bio: '小短腿大嗓门，对零食毫无抵抗力。', lat: 39.91, lng: 116.4, lastActiveAt: '2026-08-19T18:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-kele/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '老王', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u3/120/120', ownerVerified: false },
  { id: 'p-4', name: '豆包', species: 'dog', breed: '柴犬', gender: 'female', birthDate: '2021-11-11', personalityTags: ['高冷', '独立'], bio: '高冷柴，出门必带围巾。', lat: 39.9, lng: 116.415, lastActiveAt: '2026-08-18T09:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-doubao/900/600', coverWidth: 900, coverHeight: 600, ownerNickname: '小周', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u4/120/120', ownerVerified: false },
  { id: 'p-5', name: '花花', species: 'cat', breed: '中华田园猫', gender: 'female', birthDate: '2023-03-08', personalityTags: ['粘人', '怕生'], bio: '小区明星，尾巴上有朵花。', lat: 39.908, lng: 116.412, lastActiveAt: '2026-08-17T15:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-huahua/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '安安', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u5/120/120', ownerVerified: true },
  { id: 'p-6', name: '团子', species: 'cat', breed: '英国短毛猫', gender: 'male', birthDate: '2024-06-01', personalityTags: ['安静', '圆脸'], bio: '圆脸橘白，站着都能睡着。', lat: 39.895, lng: 116.4, lastActiveAt: '2026-08-16T12:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-tuanzi/800/800', coverWidth: 800, coverHeight: 800, ownerNickname: '七七', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u6/120/120', ownerVerified: false },
  { id: 'p-7', name: '旺财', species: 'dog', breed: '边牧', gender: 'male', birthDate: '2022-12-25', personalityTags: ['聪明', '精力旺盛'], bio: '智商担当，会开门会拿快递。', lat: 39.915, lng: 116.418, lastActiveAt: '2026-08-22T07:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-wangcai/600/900', coverWidth: 600, coverHeight: 900, ownerNickname: '老李', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u7/120/120', ownerVerified: true },
  { id: 'p-8', name: '咪咪', species: 'cat', breed: '美国短毛猫', gender: 'female', birthDate: '2024-09-10', personalityTags: ['好奇', '活泼'], bio: '好奇心旺盛，家里的探索者。', lat: 39.899, lng: 116.406, lastActiveAt: '2026-08-15T20:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-mimi/700/700', coverWidth: 700, coverHeight: 700, ownerNickname: '点点', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u8/120/120', ownerVerified: false },
];

const PHOTO_SEED: PhotoSeedRecord[] = [
  { id: 'ph-1', petId: 'p-1', url: 'https://picsum.photos/seed/paws-huang/600/800', width: 600, height: 800, sortOrder: 0 },
  { id: 'ph-2', petId: 'p-1', url: 'https://picsum.photos/seed/paws-huang2/800/600', width: 800, height: 600, sortOrder: 1 },
  { id: 'ph-3', petId: 'p-1', url: 'https://picsum.photos/seed/paws-huang3/600/800', width: 600, height: 800, sortOrder: 2 },
  { id: 'ph-4', petId: 'p-2', url: 'https://picsum.photos/seed/paws-naixi/800/600', width: 800, height: 600, sortOrder: 0 },
  { id: 'ph-5', petId: 'p-2', url: 'https://picsum.photos/seed/paws-naixi2/600/800', width: 600, height: 800, sortOrder: 1 },
  { id: 'ph-6', petId: 'p-3', url: 'https://picsum.photos/seed/paws-kele/600/800', width: 600, height: 800, sortOrder: 0 },
  { id: 'ph-7', petId: 'p-3', url: 'https://picsum.photos/seed/paws-kele2/900/600', width: 900, height: 600, sortOrder: 1 },
  { id: 'ph-8', petId: 'p-4', url: 'https://picsum.photos/seed/paws-doubao/900/600', width: 900, height: 600, sortOrder: 0 },
  { id: 'ph-9', petId: 'p-4', url: 'https://picsum.photos/seed/paws-doubao2/600/800', width: 600, height: 800, sortOrder: 1 },
  { id: 'ph-10', petId: 'p-5', url: 'https://picsum.photos/seed/paws-huahua/600/800', width: 600, height: 800, sortOrder: 0 },
  { id: 'ph-11', petId: 'p-5', url: 'https://picsum.photos/seed/paws-huahua2/800/800', width: 800, height: 800, sortOrder: 1 },
  { id: 'ph-12', petId: 'p-6', url: 'https://picsum.photos/seed/paws-tuanzi/800/800', width: 800, height: 800, sortOrder: 0 },
  { id: 'ph-13', petId: 'p-6', url: 'https://picsum.photos/seed/paws-tuanzi2/600/800', width: 600, height: 800, sortOrder: 1 },
  { id: 'ph-14', petId: 'p-7', url: 'https://picsum.photos/seed/paws-wangcai/600/900', width: 600, height: 900, sortOrder: 0 },
  { id: 'ph-15', petId: 'p-7', url: 'https://picsum.photos/seed/paws-wangcai2/800/600', width: 800, height: 600, sortOrder: 1 },
  { id: 'ph-16', petId: 'p-8', url: 'https://picsum.photos/seed/paws-mimi/700/700', width: 700, height: 700, sortOrder: 0 },
  { id: 'ph-17', petId: 'p-8', url: 'https://picsum.photos/seed/paws-mimi2/600/800', width: 600, height: 800, sortOrder: 1 },
];

function toPetRow(seed: PetSeedRecord, distanceMeters: number | null): PetRow {
  return {
    id: seed.id,
    name: seed.name,
    species: seed.species,
    breed: seed.breed,
    gender: seed.gender,
    birthDate: seed.birthDate,
    personalityTags: seed.personalityTags,
    bio: seed.bio,
    distanceMeters,
    coverUrl: seed.coverUrl,
    coverWidth: seed.coverWidth,
    coverHeight: seed.coverHeight,
    ownerNickname: seed.ownerNickname,
    ownerAvatarUrl: seed.ownerAvatarUrl,
    ownerVerified: seed.ownerVerified,
  };
}

@Injectable()
export class InMemoryPetRepository implements PetRepository {
  async list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }> {
    const hasCoords = typeof query.lat === 'number' && typeof query.lng === 'number';
    let rows = PET_SEED.filter((p) => {
      if (query.filter.species !== 'all' && p.species !== query.filter.species) return false;
      if (query.filter.breed !== 'all' && p.breed !== query.filter.breed) return false;
      return true;
    });

    let items: PetRow[];
    if (hasCoords) {
      const lat = query.lat as number;
      const lng = query.lng as number;
      items = rows
        .map((p) => toPetRow(p, haversineMeters(lat, lng, p.lat, p.lng)))
        .filter(
          (r) => query.radiusMeters == null || (r.distanceMeters as number) <= query.radiusMeters,
        )
        .sort((a, b) => (a.distanceMeters as number) - (b.distanceMeters as number));
    } else {
      items = rows
        .map((p) => toPetRow(p, null))
        .sort((a, b) => {
          const seedA = PET_SEED.find((s) => s.id === a.id)!;
          const seedB = PET_SEED.find((s) => s.id === b.id)!;
          return seedB.lastActiveAt.localeCompare(seedA.lastActiveAt);
        });
    }

    const offset = (query.page - 1) * query.pageSize;
    const pageItems = items.slice(offset, offset + query.pageSize);
    return { items: pageItems, hasMore: offset + pageItems.length < items.length };
  }

  async getById(
    id: string,
    coords?: { lat: number; lng: number },
  ): Promise<{ pet: PetRow; photos: PetPhotoRow[] } | null> {
    const seed = PET_SEED.find((p) => p.id === id);
    if (!seed) return null;
    const distanceMeters =
      coords != null ? haversineMeters(coords.lat, coords.lng, seed.lat, seed.lng) : null;
    const photos = PHOTO_SEED.filter((ph) => ph.petId === id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(({ id: photoId, url, width, height }) => ({ id: photoId, url, width, height }));
    return { pet: toPetRow(seed, distanceMeters), photos };
  }
}

/** PostgreSQL + PostGIS 实现（DATABASE_URL 存在时经 PetsModule 工厂注入）。 */
export class PostgresPetRepository implements PetRepository {
  constructor(private readonly pool: Pool) {}

  async list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }> {
    const hasCoords = typeof query.lat === 'number' && typeof query.lng === 'number';
    const offset = (query.page - 1) * query.pageSize;
    const species = query.filter.species;
    const breed = query.filter.breed;
    const radius = query.radiusMeters ?? null;

    let rows: PetRow[];
    if (hasCoords) {
      const res = await this.pool.query<PetRow>(
        `
        SELECT p.id, p.name, p.species, p.breed, p.gender,
               to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
               p.personality_tags AS "personalityTags", p.bio,
               ST_Distance(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters",
               ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        JOIN pet_photos ph ON ph.id = p.cover_photo_id
        JOIN users u ON u.id = p.owner_id
        WHERE p.visibility = 'public'
          AND ($3 = 'all' OR p.species = $3)
          AND ($4 = 'all' OR p.breed = $4)
          AND ($5::float8 IS NULL OR ST_DWithin(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $5))
        ORDER BY "distanceMeters" ASC
        LIMIT $6 OFFSET $7
        `,
        [query.lng, query.lat, species, breed, radius, query.pageSize, offset],
      );
      rows = res.rows;
    } else {
      const res = await this.pool.query<PetRow>(
        `
        SELECT p.id, p.name, p.species, p.breed, p.gender,
               to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
               p.personality_tags AS "personalityTags", p.bio,
               null::float8 AS "distanceMeters",
               ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        JOIN pet_photos ph ON ph.id = p.cover_photo_id
        JOIN users u ON u.id = p.owner_id
        WHERE p.visibility = 'public'
          AND ($1 = 'all' OR p.species = $1)
          AND ($2 = 'all' OR p.breed = $2)
        ORDER BY p.last_active_at DESC, p.id
        LIMIT $3 OFFSET $4
        `,
        [species, breed, query.pageSize, offset],
      );
      rows = res.rows;
    }

    const count = await this.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM pets p
       WHERE p.visibility = 'public'
         AND ($1 = 'all' OR p.species = $1)
         AND ($2 = 'all' OR p.breed = $2)`,
      [species, breed],
    );
    return { items: rows, hasMore: offset + rows.length < count.rows[0].c };
  }

  async getById(
    id: string,
    coords?: { lat: number; lng: number },
  ): Promise<{ pet: PetRow; photos: PetPhotoRow[] } | null> {
    const hasCoords = coords != null;
    const petSql = hasCoords
      ? `
        SELECT p.id, p.name, p.species, p.breed, p.gender,
               to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
               p.personality_tags AS "personalityTags", p.bio,
               ST_Distance(p.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) AS "distanceMeters",
               ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        JOIN pet_photos ph ON ph.id = p.cover_photo_id
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = $3 AND p.visibility = 'public'
        `
      : `
        SELECT p.id, p.name, p.species, p.breed, p.gender,
               to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
               p.personality_tags AS "personalityTags", p.bio,
               null::float8 AS "distanceMeters",
               ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        JOIN pet_photos ph ON ph.id = p.cover_photo_id
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = $1 AND p.visibility = 'public'
        `;
    const petRes = hasCoords
      ? await this.pool.query<PetRow>(petSql, [coords!.lng, coords!.lat, id])
      : await this.pool.query<PetRow>(petSql, [id]);
    if (petRes.rows.length === 0) return null;

    const photoRes = await this.pool.query<PetPhotoRow>(
      `SELECT id, url, width, height FROM pet_photos WHERE pet_id = $1 ORDER BY sort_order ASC`,
      [id],
    );
    return { pet: petRes.rows[0], photos: photoRes.rows };
  }
}
