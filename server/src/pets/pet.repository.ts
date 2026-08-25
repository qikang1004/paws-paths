import { randomUUID } from 'node:crypto';
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

/**
 * 建号入参。`breed` / `gender` / `birth_date` 在库里是 NOT NULL 且没有默认值，
 * 所以这三项由上层（`parsePetCreate`）补齐后一定有值 —— 仓储不猜默认。
 */
export interface PetCreateInput {
  ownerId: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  /** `YYYY-MM-DD`。 */
  birthDate: string;
  bio: string;
  personalityTags: string[];
  lat?: number;
  lng?: number;
}

/**
 * 更新入参：只含调用方真给了的字段（同 `UserProfilePatch` 的语义，
 * 缺字段表示不动）。坐标要么都给要么都不给，由上层校验成对。
 */
export interface PetPatchInput {
  name?: string;
  species?: PetSpecies;
  breed?: string;
  gender?: PetGender;
  birthDate?: string;
  bio?: string;
  personalityTags?: string[];
  lat?: number;
  lng?: number;
  coverPhotoId?: string;
}

export interface PetPhotoInput {
  url: string;
  width: number;
  height: number;
}

export interface PetRepository {
  list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }>;
  getById(id: string, coords?: { lat: number; lng: number }): Promise<{ pet: PetRow; photos: PetPhotoRow[] } | null>;
  /**
   * 归属查询：宠物不存在返回 null。
   *
   * 单独一个窄方法而不是往 PetRow 加 ownerId：ownerId 不下发到客户端，
   * 混进展示投影里容易被顺手带进响应。且这里**不过滤 visibility** ——
   * 私密宠物的主人也要能改自己的宠物（Task 9 的 403 判定用同一个方法）。
   */
  findOwnerId(petId: string): Promise<string | null>;
  /** 批量按 id 取卡片投影，保持传入顺序。关注列表这类「先有 id 再要卡片」的场景用它。 */
  listByIds(petIds: string[], coords?: { lat: number; lng: number }): Promise<PetRow[]>;

  /** 建号，返回新宠物 id。刚建的宠物没有照片，因此还进不了 `list` 的瀑布流。 */
  create(input: PetCreateInput): Promise<string>;
  /** 宠物不存在返回 false；归属校验在上层（`findOwnerId`），仓储不做鉴权。 */
  update(petId: string, patch: PetPatchInput): Promise<boolean>;
  /**
   * 硬删。`pet_photos.pet_id` 是阶段 1 建的外键且**没有** ON DELETE CASCADE，
   * 所以照片必须在同一个事务里显式删掉；`follows` / `posts` 靠自己的级联走。
   */
  remove(petId: string): Promise<boolean>;
  /** 加一张照片；这是这只宠物的第一张时顺带成为封面。 */
  addPhoto(petId: string, photo: PetPhotoInput): Promise<PetPhotoRow>;
  /** 删照片；删掉的是封面时封面顶给剩下的第一张，一张不剩就置空。 */
  removePhoto(petId: string, photoId: string): Promise<boolean>;
  /** 换封面前的归属校验：这张照片是不是这只宠物的。 */
  hasPhoto(petId: string, photoId: string): Promise<boolean>;
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
  /** 与 seed.sql 的 pets.owner_id 一致；不进 PetRow，不下发客户端。 */
  ownerId: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: PetGender;
  birthDate: string;
  personalityTags: string[];
  bio: string;
  /** 城市模式（用户没授权定位）下建的宠物没有坐标，距离一律 null。 */
  lat: number | null;
  lng: number | null;
  lastActiveAt: string;
  /**
   * 封面指针，对应 `pets.cover_photo_id`。为 null 表示这只宠物还没有照片 ——
   * 它进不了瀑布流（卡片是照片打底的），但详情页要打得开，主人才有地方加照片。
   */
  coverPhotoId?: string | null;
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
  { id: 'p-1', ownerId: 'u-1', name: '大黄', species: 'dog', breed: '金毛', gender: 'male', birthDate: '2022-05-01', personalityTags: ['黏人', '爱玩水'], bio: '爱玩水的暖男，见到谁都摇尾巴。', lat: 39.906, lng: 116.404, lastActiveAt: '2026-08-20T10:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-huang/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '小陈', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u1/120/120', ownerVerified: true },
  { id: 'p-2', ownerId: 'u-2', name: '奶昔', species: 'cat', breed: '布偶', gender: 'female', birthDate: '2024-02-14', personalityTags: ['温柔', '爱睡觉'], bio: '蓝眼睛的小公主，喜欢被摸下巴。', lat: 39.902, lng: 116.41, lastActiveAt: '2026-08-21T08:30:00Z', coverUrl: 'https://picsum.photos/seed/paws-naixi/800/600', coverWidth: 800, coverHeight: 600, ownerNickname: '阿喵', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u2/120/120', ownerVerified: true },
  { id: 'p-3', ownerId: 'u-3', name: '可乐', species: 'dog', breed: '柯基', gender: 'male', birthDate: '2023-08-20', personalityTags: ['活泼', '贪吃'], bio: '小短腿大嗓门，对零食毫无抵抗力。', lat: 39.91, lng: 116.4, lastActiveAt: '2026-08-19T18:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-kele/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '老王', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u3/120/120', ownerVerified: false },
  { id: 'p-4', ownerId: 'u-4', name: '豆包', species: 'dog', breed: '柴犬', gender: 'female', birthDate: '2021-11-11', personalityTags: ['高冷', '独立'], bio: '高冷柴，出门必带围巾。', lat: 39.9, lng: 116.415, lastActiveAt: '2026-08-18T09:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-doubao/900/600', coverWidth: 900, coverHeight: 600, ownerNickname: '小周', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u4/120/120', ownerVerified: false },
  { id: 'p-5', ownerId: 'u-5', name: '花花', species: 'cat', breed: '中华田园猫', gender: 'female', birthDate: '2023-03-08', personalityTags: ['粘人', '怕生'], bio: '小区明星，尾巴上有朵花。', lat: 39.908, lng: 116.412, lastActiveAt: '2026-08-17T15:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-huahua/600/800', coverWidth: 600, coverHeight: 800, ownerNickname: '安安', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u5/120/120', ownerVerified: true },
  { id: 'p-6', ownerId: 'u-6', name: '团子', species: 'cat', breed: '英国短毛猫', gender: 'male', birthDate: '2024-06-01', personalityTags: ['安静', '圆脸'], bio: '圆脸橘白，站着都能睡着。', lat: 39.895, lng: 116.4, lastActiveAt: '2026-08-16T12:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-tuanzi/800/800', coverWidth: 800, coverHeight: 800, ownerNickname: '七七', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u6/120/120', ownerVerified: false },
  { id: 'p-7', ownerId: 'u-7', name: '旺财', species: 'dog', breed: '边牧', gender: 'male', birthDate: '2022-12-25', personalityTags: ['聪明', '精力旺盛'], bio: '智商担当，会开门会拿快递。', lat: 39.915, lng: 116.418, lastActiveAt: '2026-08-22T07:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-wangcai/600/900', coverWidth: 600, coverHeight: 900, ownerNickname: '老李', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u7/120/120', ownerVerified: true },
  { id: 'p-8', ownerId: 'u-8', name: '咪咪', species: 'cat', breed: '美国短毛猫', gender: 'female', birthDate: '2024-09-10', personalityTags: ['好奇', '活泼'], bio: '好奇心旺盛，家里的探索者。', lat: 39.899, lng: 116.406, lastActiveAt: '2026-08-15T20:00:00Z', coverUrl: 'https://picsum.photos/seed/paws-mimi/700/700', coverWidth: 700, coverHeight: 700, ownerNickname: '点点', ownerAvatarUrl: 'https://picsum.photos/seed/paw-u8/120/120', ownerVerified: false },
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

/** 没有坐标的宠物（城市模式下建的）距离一律 null，而不是假装 0 米。 */
function distanceTo(seed: PetSeedRecord, coords?: { lat: number; lng: number }): number | null {
  if (coords == null || seed.lat == null || seed.lng == null) return null;
  return haversineMeters(coords.lat, coords.lng, seed.lat, seed.lng);
}

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
  /**
   * 种子的**可变副本**。写端点会改这两个数组，直接改模块级常量的话，
   * 同一进程里的下一个测试套件会看到上一个套件建的宠物。
   */
  private readonly pets: PetSeedRecord[] = PET_SEED.map((p) => ({
    ...p,
    personalityTags: [...p.personalityTags],
    coverPhotoId: PHOTO_SEED.filter((ph) => ph.petId === p.id).sort(
      (a, b) => a.sortOrder - b.sortOrder,
    )[0]?.id ?? null,
  }));
  private readonly photos: PhotoSeedRecord[] = PHOTO_SEED.map((ph) => ({ ...ph }));

  async list(query: PetQuery): Promise<{ items: PetRow[]; hasMore: boolean }> {
    const hasCoords = typeof query.lat === 'number' && typeof query.lng === 'number';
    const rows = this.pets.filter((p) => {
      if (query.filter.species !== 'all' && p.species !== query.filter.species) return false;
      if (query.filter.breed !== 'all' && p.breed !== query.filter.breed) return false;
      // 没有封面的宠物不进瀑布流，对应 Postgres 侧那个 JOIN pet_photos。
      if (p.coverPhotoId == null) return false;
      return true;
    });

    let items: PetRow[];
    if (hasCoords) {
      const coords = { lat: query.lat as number, lng: query.lng as number };
      items = rows
        .map((p) => toPetRow(p, distanceTo(p, coords)))
        .filter(
          (r) =>
            query.radiusMeters == null ||
            (r.distanceMeters != null && r.distanceMeters <= query.radiusMeters),
        )
        // 没坐标的排在最后（同 Postgres 的 ORDER BY ... ASC 把 NULL 放尾部）。
        .sort(
          (a, b) =>
            (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
            (b.distanceMeters ?? Number.POSITIVE_INFINITY),
        );
    } else {
      items = rows
        .map((p) => toPetRow(p, null))
        .sort((a, b) => {
          const seedA = this.pets.find((s) => s.id === a.id)!;
          const seedB = this.pets.find((s) => s.id === b.id)!;
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
    const seed = this.pets.find((p) => p.id === id);
    if (!seed) return null;
    // 刻意不过滤封面：没有照片的宠物详情页也要打得开。
    const photos = this.photosOf(id).map(({ id: photoId, url, width, height }) => ({
      id: photoId,
      url,
      width,
      height,
    }));
    return { pet: toPetRow(seed, distanceTo(seed, coords)), photos };
  }

  async findOwnerId(petId: string): Promise<string | null> {
    return this.pets.find((p) => p.id === petId)?.ownerId ?? null;
  }

  async listByIds(petIds: string[], coords?: { lat: number; lng: number }): Promise<PetRow[]> {
    return petIds
      .map((id) => this.pets.find((p) => p.id === id))
      .filter((seed): seed is PetSeedRecord => seed != null && seed.coverPhotoId != null)
      .map((seed) => toPetRow(seed, distanceTo(seed, coords)));
  }

  async create(input: PetCreateInput): Promise<string> {
    const id = `p-${randomUUID()}`;
    this.pets.push({
      id,
      ownerId: input.ownerId,
      name: input.name,
      species: input.species,
      breed: input.breed,
      gender: input.gender,
      birthDate: input.birthDate,
      personalityTags: [...input.personalityTags],
      bio: input.bio,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      lastActiveAt: new Date().toISOString(),
      // 还没有照片 —— 详情页打得开，但进不了瀑布流。
      coverPhotoId: null,
      coverUrl: '',
      coverWidth: 0,
      coverHeight: 0,
      // 无库模式下仓储看不见 users（那是另一个仓储），主人信息一律落占位值。
      // 与 findProfile 的三个计数恒为 0 同一取向：只影响演示降级模式。
      ownerNickname: '微信用户',
      ownerAvatarUrl: null,
      ownerVerified: false,
    });
    return id;
  }

  async update(petId: string, patch: PetPatchInput): Promise<boolean> {
    const seed = this.pets.find((p) => p.id === petId);
    if (!seed) return false;
    if (patch.name !== undefined) seed.name = patch.name;
    if (patch.species !== undefined) seed.species = patch.species;
    if (patch.breed !== undefined) seed.breed = patch.breed;
    if (patch.gender !== undefined) seed.gender = patch.gender;
    if (patch.birthDate !== undefined) seed.birthDate = patch.birthDate;
    if (patch.bio !== undefined) seed.bio = patch.bio;
    if (patch.personalityTags !== undefined) seed.personalityTags = [...patch.personalityTags];
    if (patch.lat !== undefined) seed.lat = patch.lat;
    if (patch.lng !== undefined) seed.lng = patch.lng;
    if (patch.coverPhotoId !== undefined) {
      // 归属已在上层用 hasPhoto 校验过，这里再兜一次：换封面只认自己的照片。
      const photo = this.photos.find((ph) => ph.id === patch.coverPhotoId && ph.petId === petId);
      if (photo) this.setCover(seed, photo);
    }
    return true;
  }

  async remove(petId: string): Promise<boolean> {
    const at = this.pets.findIndex((p) => p.id === petId);
    if (at < 0) return false;
    this.pets.splice(at, 1);
    for (let i = this.photos.length - 1; i >= 0; i -= 1) {
      if (this.photos[i].petId === petId) this.photos.splice(i, 1);
    }
    return true;
  }

  async addPhoto(petId: string, photo: PetPhotoInput): Promise<PetPhotoRow> {
    const seed = this.pets.find((p) => p.id === petId);
    if (!seed) throw new Error(`pet ${petId} not found`);
    const existing = this.photosOf(petId);
    const row: PhotoSeedRecord = {
      id: `ph-${randomUUID()}`,
      petId,
      url: photo.url,
      width: photo.width,
      height: photo.height,
      sortOrder: existing.length ? existing[existing.length - 1].sortOrder + 1 : 0,
    };
    this.photos.push(row);
    // 第一张自动成封面：否则新建的宠物永远进不了广场。
    if (seed.coverPhotoId == null) this.setCover(seed, row);
    return { id: row.id, url: row.url, width: row.width, height: row.height };
  }

  async removePhoto(petId: string, photoId: string): Promise<boolean> {
    const at = this.photos.findIndex((ph) => ph.id === photoId && ph.petId === petId);
    if (at < 0) return false;
    this.photos.splice(at, 1);
    const seed = this.pets.find((p) => p.id === petId);
    // 删掉的正是封面：顶给剩下的第一张，一张不剩就置空（宠物随之退出瀑布流）。
    if (seed && seed.coverPhotoId === photoId) this.setCover(seed, this.photosOf(petId)[0] ?? null);
    return true;
  }

  async hasPhoto(petId: string, photoId: string): Promise<boolean> {
    return this.photos.some((ph) => ph.id === photoId && ph.petId === petId);
  }

  /** 这只宠物的照片，按 sortOrder 升序（同 Postgres 侧的 ORDER BY sort_order）。 */
  private photosOf(petId: string): PhotoSeedRecord[] {
    return this.photos.filter((ph) => ph.petId === petId).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * 封面指针连着三个冗余字段一起挪。`coverUrl` / `coverWidth` / `coverHeight`
   * 是卡片投影直接读的（Postgres 侧靠 JOIN 拿到），这里必须手工保持同步。
   */
  private setCover(seed: PetSeedRecord, photo: PhotoSeedRecord | null): void {
    seed.coverPhotoId = photo?.id ?? null;
    seed.coverUrl = photo?.url ?? '';
    seed.coverWidth = photo?.width ?? 0;
    seed.coverHeight = photo?.height ?? 0;
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

    // 计数必须和上面的取数用同一套过滤：没有封面的宠物被 JOIN 挡在页外，
    // 却算进总数的话，`hasMore` 会指向一页永远取不出内容的幻影下一页。
    const count = await this.pool.query<{ c: number }>(
      `SELECT count(*)::int AS c
       FROM pets p
       WHERE p.visibility = 'public'
         AND ($1 = 'all' OR p.species = $1)
         AND ($2 = 'all' OR p.breed = $2)
         AND EXISTS (SELECT 1 FROM pet_photos ph WHERE ph.id = p.cover_photo_id)`,
      [species, breed],
    );
    return { items: rows, hasMore: offset + rows.length < count.rows[0].c };
  }

  /**
   * 详情。封面走 **LEFT** JOIN：刚建好还没传照片的宠物必须打得开详情页 ——
   * 否则主人根本没有入口进去加第一张照片。`list` / `listByIds` 仍是 INNER JOIN，
   * 因为卡片是照片打底的，没封面渲染不出来。
   */
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
               COALESCE(ph.url, '') AS "coverUrl", COALESCE(ph.width, 0) AS "coverWidth",
               COALESCE(ph.height, 0) AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        LEFT JOIN pet_photos ph ON ph.id = p.cover_photo_id
        JOIN users u ON u.id = p.owner_id
        WHERE p.id = $3 AND p.visibility = 'public'
        `
      : `
        SELECT p.id, p.name, p.species, p.breed, p.gender,
               to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
               p.personality_tags AS "personalityTags", p.bio,
               null::float8 AS "distanceMeters",
               COALESCE(ph.url, '') AS "coverUrl", COALESCE(ph.width, 0) AS "coverWidth",
               COALESCE(ph.height, 0) AS "coverHeight",
               u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl", u.is_verified_owner AS "ownerVerified"
        FROM pets p
        LEFT JOIN pet_photos ph ON ph.id = p.cover_photo_id
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

  async findOwnerId(petId: string): Promise<string | null> {
    // 不带 visibility 过滤：私密宠物的主人也要能操作自己的宠物。
    const { rows } = await this.pool.query<{ owner_id: string }>(
      `SELECT owner_id FROM pets WHERE id = $1`,
      [petId],
    );
    return rows.length ? rows[0].owner_id : null;
  }

  async listByIds(petIds: string[], coords?: { lat: number; lng: number }): Promise<PetRow[]> {
    if (petIds.length === 0) return [];
    const hasCoords = coords != null;
    // 按传入顺序返回：array_position 让库层排序，免得回来再排一遍。
    const distanceExpr = hasCoords
      ? `ST_Distance(p.location, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography)`
      : `null::float8`;
    const sql = `
      SELECT p.id, p.name, p.species, p.breed, p.gender,
             to_char(p.birth_date, 'YYYY-MM-DD') AS "birthDate",
             p.personality_tags AS "personalityTags", p.bio,
             ${distanceExpr} AS "distanceMeters",
             ph.url AS "coverUrl", ph.width AS "coverWidth", ph.height AS "coverHeight",
             u.nickname AS "ownerNickname", u.avatar_url AS "ownerAvatarUrl",
             u.is_verified_owner AS "ownerVerified"
      FROM pets p
      JOIN pet_photos ph ON ph.id = p.cover_photo_id
      JOIN users u ON u.id = p.owner_id
      WHERE p.id = ANY($1) AND p.visibility = 'public'
      ORDER BY array_position($1::text[], p.id)
    `;
    const params = hasCoords ? [petIds, coords.lng, coords.lat] : [petIds];
    const { rows } = await this.pool.query<PetRow>(sql, params);
    return rows;
  }

  async create(input: PetCreateInput): Promise<string> {
    const id = `p-${randomUUID()}`;
    // 坐标要么都给要么都不给（上层已校验成对）；没给就落 NULL，
    // 而不是 ST_MakePoint(0, 0) —— 几内亚湾那个点会被半径筛选当成真实位置。
    await this.pool.query(
      `INSERT INTO pets (id, owner_id, name, species, breed, gender, birth_date, bio, personality_tags, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
               CASE WHEN $10::float8 IS NULL THEN NULL
                    ELSE ST_SetSRID(ST_MakePoint($10, $11), 4326)::geography END)`,
      [
        id,
        input.ownerId,
        input.name,
        input.species,
        input.breed,
        input.gender,
        input.birthDate,
        input.bio,
        input.personalityTags,
        input.lng ?? null,
        input.lat ?? null,
      ],
    );
    return id;
  }

  async update(petId: string, patch: PetPatchInput): Promise<boolean> {
    // 只拼调用方真给了的列（同 PostgresUserRepository.updateProfile）：
    // 列名是这里的定值，不来自请求体，没有注入面。
    const sets: string[] = [];
    const values: unknown[] = [petId];
    const set = (column: string, value: unknown): void => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (patch.name !== undefined) set('name', patch.name);
    if (patch.species !== undefined) set('species', patch.species);
    if (patch.breed !== undefined) set('breed', patch.breed);
    if (patch.gender !== undefined) set('gender', patch.gender);
    if (patch.birthDate !== undefined) set('birth_date', patch.birthDate);
    if (patch.bio !== undefined) set('bio', patch.bio);
    if (patch.personalityTags !== undefined) set('personality_tags', patch.personalityTags);
    if (patch.coverPhotoId !== undefined) set('cover_photo_id', patch.coverPhotoId);
    if (patch.lat !== undefined && patch.lng !== undefined) {
      values.push(patch.lng, patch.lat);
      sets.push(
        `location = ST_SetSRID(ST_MakePoint($${values.length - 1}, $${values.length}), 4326)::geography`,
      );
    }
    if (sets.length === 0) {
      // 一个可改字段都没给：上层会先挡成 422，这里只保证不发一条空 UPDATE。
      const { rowCount } = await this.pool.query(`SELECT 1 FROM pets WHERE id = $1`, [petId]);
      return rowCount === 1;
    }

    const { rowCount } = await this.pool.query(
      `UPDATE pets SET ${sets.join(', ')} WHERE id = $1`,
      values,
    );
    return rowCount === 1;
  }

  async remove(petId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // 照片得自己删：pet_photos.pet_id 是阶段 1 建的外键，没有 ON DELETE CASCADE。
      // follows / posts / post_images 是阶段 2 的表，带级联，不用管。
      await client.query(`DELETE FROM pet_photos WHERE pet_id = $1`, [petId]);
      // favorites / view_history 是多态表（target_type + target_id），target_id 上
      // **没有**外键可挂，级联指望不上 —— 不显式删就会留下孤儿行，
      // 一直把个人中心的 favoriteCount 撑高，指向一只已经不存在的宠物。
      await client.query(
        `DELETE FROM favorites WHERE target_type = 'pet' AND target_id = $1`,
        [petId],
      );
      await client.query(
        `DELETE FROM view_history WHERE target_type = 'pet' AND target_id = $1`,
        [petId],
      );
      const { rowCount } = await client.query(`DELETE FROM pets WHERE id = $1`, [petId]);
      await client.query('COMMIT');
      return rowCount === 1;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 一条语句搞定「插照片 + 必要时设封面」。两句话拆开就要 BEGIN/COMMIT 兜原子性，
   * 而远程库单次往返 ~200ms，一个事务四次往返 —— 数据修改型 CTE 一次就够，
   * 且它们保证各执行一次、执行到底，不管主查询有没有读它们的输出。
   */
  async addPhoto(petId: string, photo: PetPhotoInput): Promise<PetPhotoRow> {
    const id = `ph-${randomUUID()}`;
    const { rows } = await this.pool.query<PetPhotoRow>(
      `WITH inserted AS (
         INSERT INTO pet_photos (id, pet_id, url, width, height, sort_order)
         VALUES ($1, $2, $3, $4, $5,
                 COALESCE((SELECT max(sort_order) + 1 FROM pet_photos WHERE pet_id = $2), 0))
         RETURNING id, url, width, height
       ), cover AS (
         -- 第一张自动成封面：没封面的宠物进不了广场瀑布流（那边是 INNER JOIN）。
         UPDATE pets SET cover_photo_id = $1 WHERE id = $2 AND cover_photo_id IS NULL
       )
       SELECT id, url, width, height FROM inserted`,
      [id, petId, photo.url, photo.width, photo.height],
    );
    return rows[0];
  }

  async removePhoto(petId: string, photoId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ c: number }>(
      // pet_id 一起进 WHERE：别的宠物的照片 id 落到这个端点上必须删不动。
      `WITH deleted AS (
         DELETE FROM pet_photos WHERE id = $1 AND pet_id = $2 RETURNING id
       ), promoted AS (
         -- 删掉的正是封面：顶给剩下的第一张，一张不剩就置空（宠物随之退出瀑布流）。
         -- id <> $1 不能省：CTE 里的子查询读的是语句开始时的快照，刚删的那张还在里面。
         UPDATE pets SET cover_photo_id =
           (SELECT id FROM pet_photos
            WHERE pet_id = $2 AND id <> $1 ORDER BY sort_order ASC LIMIT 1)
         WHERE id = $2 AND cover_photo_id = $1 AND EXISTS (SELECT 1 FROM deleted)
       )
       SELECT count(*)::int AS c FROM deleted`,
      [photoId, petId],
    );
    return rows[0].c === 1;
  }

  async hasPhoto(petId: string, photoId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM pet_photos WHERE id = $1 AND pet_id = $2`,
      [photoId, petId],
    );
    return rowCount === 1;
  }
}
