import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type AuditStatus } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { auditStatusOfLane } from '../uploads/image-storage';
import { UploadsService } from '../uploads/uploads.service';
import {
  PET_REPOSITORY,
  type PetCreateInput,
  type PetGender,
  type PetPatchInput,
  type PetPhotoInput,
  type PetRepository,
  type PetRow,
  type PetSpecies,
} from './pet.repository';

/** DTO（camelCase），形状与 packages/types 的 PetSummary/PetDetail/PetListResponse 一致。 */
export interface PetSummary {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: 'male' | 'female' | 'unknown';
  birthDate: string;
  coverUrl: string;
  coverWidth: number;
  coverHeight: number;
  personalityTags: string[];
  distanceMeters: number | null;
  ownerNickname: string;
  ownerAvatarUrl: string | null;
  ownerVerified: boolean;
  isFollowing: boolean;
}

export interface PetPhoto {
  id: string;
  url: string;
  width: number;
  height: number;
  /** 审核状态。别人看到的恒为过审的照片；主人能看到自己的待审照片（编辑页画角标）。 */
  auditStatus: AuditStatus;
}

export interface PetDetail {
  id: string;
  name: string;
  species: PetSpecies;
  breed: string;
  gender: 'male' | 'female' | 'unknown';
  birthDate: string;
  bio: string;
  personalityTags: string[];
  distanceMeters: number | null;
  owner: { nickname: string; avatarUrl: string | null; ownerVerified: boolean };
  photos: PetPhoto[];
  isFollowing: boolean;
  isFavorite: boolean;
  /**
   * 这只宠物是不是**看的人自己的**。未登录一律 false。
   *
   * 客户端拿它决定关注按钮出不出现（关注自己是 `FOLLOW_SELF:42203`）。
   * 下发布尔值而不是 `ownerId` —— 主人的用户 id 不进公开响应，
   * 同 `PetRepository.findOwnerId` 那条「ownerId 不下发客户端」的注释。
   */
  isOwn: boolean;
}

export interface PetListResponse {
  items: PetSummary[];
  hasMore: boolean;
  page: number;
}

const VALID_SPECIES: ReadonlySet<string> = new Set(['all', 'dog', 'cat', 'other']);

/** 长度上限一律按**码点数**（`[...s].length`）：`String.length` 下一个 emoji 顶两格。 */
export const PET_NAME_MAX_LENGTH = 20;
export const PET_BREED_MAX_LENGTH = 20;
export const PET_BIO_MAX_LENGTH = 200;
export const PET_TAG_MAX_LENGTH = 10;
export const PET_TAGS_MAX_COUNT = 5;

/** 写入侧的物种白名单**不含 `all`** —— 那是筛选用的伪物种，不是一种宠物。 */
const WRITABLE_SPECIES: ReadonlySet<string> = new Set(['dog', 'cat', 'other']);
const VALID_GENDERS: ReadonlySet<string> = new Set(['male', 'female', 'unknown']);
/** 只收 http(s) 绝对地址与站内路径（上传通道落的就是站内路径），同 `parseProfilePatch`。 */
const IMAGE_URL_RE = /^(https?:\/\/|\/)\S+$/;

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function parseName(raw: unknown): string {
  if (typeof raw !== 'string') fail('名字必须是字符串');
  const name = raw.trim();
  if (name.length === 0) fail('名字不能为空');
  if ([...name].length > PET_NAME_MAX_LENGTH) fail(`名字最多 ${PET_NAME_MAX_LENGTH} 个字`);
  return name;
}

function parseSpecies(raw: unknown): PetSpecies {
  if (typeof raw !== 'string' || !WRITABLE_SPECIES.has(raw)) fail('物种只能是 dog / cat / other');
  return raw as PetSpecies;
}

function parseBreed(raw: unknown): string {
  if (typeof raw !== 'string') fail('品种必须是字符串');
  const breed = raw.trim();
  if ([...breed].length > PET_BREED_MAX_LENGTH) fail(`品种最多 ${PET_BREED_MAX_LENGTH} 个字`);
  return breed;
}

function parseGender(raw: unknown): PetGender {
  if (typeof raw !== 'string' || !VALID_GENDERS.has(raw)) {
    fail('性别只能是 male / female / unknown');
  }
  return raw as PetGender;
}

/**
 * `YYYY-MM-DD`，且必须是真实存在的日期。光有正则挡不住 `2024-02-30`：
 * `DATE` 列会直接报错，而 `Date` 会把它静默滚成 3 月 1 日 —— 两种都不该让客户端看见。
 */
function parseBirthDate(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    fail('生日格式必须是 YYYY-MM-DD');
  }
  const [year, month, day] = raw.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    fail('生日不是一个真实存在的日期');
  }
  return raw;
}

function parseBio(raw: unknown): string {
  if (typeof raw !== 'string') fail('简介必须是字符串');
  const bio = raw.trim();
  if ([...bio].length > PET_BIO_MAX_LENGTH) fail(`简介最多 ${PET_BIO_MAX_LENGTH} 个字`);
  return bio;
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) fail('性格标签必须是数组');
  if (raw.length > PET_TAGS_MAX_COUNT) fail(`性格标签最多 ${PET_TAGS_MAX_COUNT} 个`);
  return raw.map((item) => {
    if (typeof item !== 'string') fail('性格标签必须是字符串');
    const tag = item.trim();
    if (tag.length === 0) fail('性格标签不能为空');
    if ([...tag].length > PET_TAG_MAX_LENGTH) fail(`每个性格标签最多 ${PET_TAG_MAX_LENGTH} 个字`);
    return tag;
  });
}

/**
 * 坐标要么都给要么都不给：只给一个的话仓储没法拼出一个点，
 * 而补 0 会把宠物放到几内亚湾那个 (0, 0) 上，被半径筛选当成真实位置。
 */
function parseCoords(body: Record<string, unknown>): { lat?: number; lng?: number } {
  const hasLat = body.lat !== undefined;
  const hasLng = body.lng !== undefined;
  if (!hasLat && !hasLng) return {};
  if (hasLat !== hasLng) fail('经纬度必须成对提供');
  const { lat, lng } = body;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) fail('纬度必须是数值');
  if (typeof lng !== 'number' || !Number.isFinite(lng)) fail('经度必须是数值');
  if (lat < -90 || lat > 90) fail('纬度超出范围');
  if (lng < -180 || lng > 180) fail('经度超出范围');
  return { lat, lng };
}

/** 宽高**非可选**：瀑布流要靠它在图片加载前算出占位高度（spec §4.1）。 */
function parseDimension(raw: unknown, label: string): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) fail(`${label}必须是正整数`);
  return raw;
}

/** 建号当天（UTC）的 `YYYY-MM-DD`。 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `POST /pets` 的请求体校验。只有名字与物种必填，其余落默认值 ——
 * 建号那一刻主人手上通常只有这两样，逼他填齐会把人挡在门外。
 */
export function parsePetCreate(ownerId: string, body: Record<string, unknown>): PetCreateInput {
  const coords = parseCoords(body);
  return {
    ownerId,
    name: parseName(body.name),
    species: parseSpecies(body.species),
    breed: body.breed !== undefined ? parseBreed(body.breed) : '',
    gender: body.gender !== undefined ? parseGender(body.gender) : 'unknown',
    // `pets.birth_date` 是 NOT NULL 且没有默认值（阶段 1 的列，Global Constraint 22 不许改），
    // 所以没给生日只能落建号当天：年龄显示成 0，主人一眼就看得出这里要补。
    birthDate: body.birthDate !== undefined ? parseBirthDate(body.birthDate) : todayIso(),
    bio: body.bio !== undefined ? parseBio(body.bio) : '',
    personalityTags: body.personalityTags !== undefined ? parseTags(body.personalityTags) : [],
    ...coords,
  };
}

/**
 * `PATCH /pets/:id` 的请求体校验。只含调用方真给了的字段（同 `parseProfilePatch`）；
 * 一个可改字段都没给 → 422，静默 200 只会让写错字段名的 bug 更难查。
 *
 * `id` / `ownerId` / `visibility` 这些不在白名单里的键被直接忽略 ——
 * 归属由路径参数决定，客户端塞不进来。
 */
export function parsePetPatch(body: Record<string, unknown>): PetPatchInput {
  const patch: PetPatchInput = { ...parseCoords(body) };
  if (body.name !== undefined) patch.name = parseName(body.name);
  if (body.species !== undefined) patch.species = parseSpecies(body.species);
  if (body.breed !== undefined) patch.breed = parseBreed(body.breed);
  if (body.gender !== undefined) patch.gender = parseGender(body.gender);
  if (body.birthDate !== undefined) patch.birthDate = parseBirthDate(body.birthDate);
  if (body.bio !== undefined) patch.bio = parseBio(body.bio);
  if (body.personalityTags !== undefined) patch.personalityTags = parseTags(body.personalityTags);
  if (body.coverPhotoId !== undefined) {
    const raw = body.coverPhotoId;
    if (typeof raw !== 'string' || raw.trim().length === 0) fail('封面照片 id 不合法');
    patch.coverPhotoId = raw.trim();
  }
  if (Object.keys(patch).length === 0) fail('没有需要更新的字段');
  return patch;
}

/**
 * `POST /pets/:id/photos` 的请求体校验。返回值不含 `auditStatus` ——
 * 那是服务端按文件所在的档自己算的，请求体里给了也不认。
 */
export function parsePetPhoto(body: Record<string, unknown>): Omit<PetPhotoInput, 'auditStatus'> {
  const raw = body.url;
  if (typeof raw !== 'string' || !IMAGE_URL_RE.test(raw.trim())) fail('照片地址不合法');
  return {
    url: raw.trim(),
    width: parseDimension(body.width, '宽度'),
    height: parseDimension(body.height, '高度'),
  };
}

@Injectable()
export class PetsService {
  constructor(
    @Inject(PET_REPOSITORY) private readonly repo: PetRepository,
    private readonly uploads: UploadsService,
  ) {}

  async list(query: {
    filter: { species: string; breed: string };
    page: number;
    pageSize: number;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
  }): Promise<PetListResponse> {
    if (!VALID_SPECIES.has(query.filter.species) || !query.filter.breed) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        '非法的筛选参数',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { items, hasMore } = await this.repo.list({
      filter: { species: query.filter.species as PetSpecies | 'all', breed: query.filter.breed },
      page: query.page,
      pageSize: query.pageSize,
      lat: query.lat,
      lng: query.lng,
      radiusMeters: query.radiusMeters,
    });
    return { items: items.map(toSummary), hasMore, page: query.page };
  }

  /**
   * 「我的宠物」。不分页、不筛封面（刚建好还没传照片的宠物也要出现），
   * 距离一律 null —— 自己的宠物清单不显示距离。
   */
  async listByOwner(ownerId: string): Promise<{ items: PetSummary[] }> {
    const rows = await this.repo.listByOwner(ownerId);
    // `isFollowing` 保持 `false` 且不再覆盖：关注自己的宠物在 FollowsService 里是 422，
    // 所以这张清单上的每一项恒为未关注。
    return { items: rows.map(toSummary) };
  }

  /**
   * 详情。
   *
   * `viewerId` 用来算 `isOwn`（关注按钮出不出现），也决定照片的可见范围：
   * 主人看得见自己全部的照片（含待审的，客户端画「审核中」），别人与未登录只看得见
   * 过审的 —— 筛在仓储的 SQL 里，不是取回来再过滤。
   *
   * 归属走 `findOwnerId` 而不是往 `PetRow` 加 `ownerId`：主人的用户 id 不下发
   * 客户端，混进展示投影里容易被顺手带进响应（同 `findOwnerId` 的既有注释）。
   * 未登录时不查这一发 —— 没有 viewer 就一定不是「我的」。
   */
  async detail(
    id: string,
    opts?: { lat?: number; lng?: number; viewerId?: string | null },
  ): Promise<PetDetail | null> {
    const coords =
      opts && typeof opts.lat === 'number' && typeof opts.lng === 'number'
        ? { lat: opts.lat, lng: opts.lng }
        : undefined;
    const viewerId = opts?.viewerId ?? null;
    // 归属要在取照片之前算出来：它决定待审照片给不给。
    const isOwn = viewerId != null && (await this.repo.findOwnerId(id)) === viewerId;
    const found = await this.repo.getById(id, coords, { includeHidden: isOwn });
    if (!found) return null;
    const { pet, photos } = found;
    return {
      id: pet.id,
      name: pet.name,
      species: pet.species,
      breed: pet.breed,
      gender: pet.gender,
      birthDate: pet.birthDate,
      bio: pet.bio,
      personalityTags: pet.personalityTags,
      distanceMeters: pet.distanceMeters,
      owner: {
        nickname: pet.ownerNickname,
        avatarUrl: pet.ownerAvatarUrl,
        ownerVerified: pet.ownerVerified,
      },
      photos,
      // 同 toSummary：这里拿不到登录态，由 FollowsService.markFollowing 覆盖。
      isFollowing: false,
      // 同理，由 PetsController 用 FavoritesService.isFavorite 覆盖。
      isFavorite: false,
      isOwn,
    };
  }

  async create(ownerId: string, body: Record<string, unknown>): Promise<{ id: string }> {
    // 刚建的宠物还没有照片，所以还进不了广场瀑布流（卡片是照片打底的）。
    // 主人的下一步是 POST /pets/:id/photos，第一张照片自动成为封面。
    return { id: await this.repo.create(parsePetCreate(ownerId, body)) };
  }

  async update(petId: string, userId: string, body: Record<string, unknown>): Promise<PetDetail> {
    await this.assertOwner(petId, userId);
    const patch = parsePetPatch(body);
    // 换封面只认这只宠物自己的照片：封面是 `pets.cover_photo_id` 这一个指针，
    // 指到别人的照片上就等于把别人的图挂在自己卡片上。
    if (patch.coverPhotoId != null && !(await this.repo.hasPhoto(petId, patch.coverPhotoId))) {
      fail('封面只能选这只宠物自己的照片');
    }
    await this.repo.update(petId, patch);
    // 回读带上主人自己：编辑页拿这份响应重画相册，待审照片不能在这一步消失。
    const updated = await this.detail(petId, { viewerId: userId });
    // 走不到：`getById` 只过滤 visibility，而本阶段没有任何入口把宠物设成私密。
    // 真出现的话说明宠物在这两次查询之间被删了，报 404 比发一份半截资料诚实。
    if (!updated) this.notFound();
    return updated;
  }

  async remove(petId: string, userId: string): Promise<{ deleted: boolean }> {
    await this.assertOwner(petId, userId);
    // 硬删，没有墓碑：本阶段没有审计要求（计划 Task 9）。
    if (!(await this.repo.remove(petId))) this.notFound();
    return { deleted: true };
  }

  async addPhoto(
    petId: string,
    userId: string,
    body: Record<string, unknown>,
  ): Promise<PetPhoto> {
    await this.assertOwner(petId, userId);
    const photo = parsePetPhoto(body);
    // 机审发生在上传那一步，结论就是文件所在的档（同发动态的图片）。
    const auditStatus = auditStatusOfLane(await this.uploads.laneOfUrl(photo.url));
    return this.repo.addPhoto(petId, { ...photo, auditStatus });
  }

  async removePhoto(petId: string, photoId: string, userId: string): Promise<{ deleted: boolean }> {
    await this.assertOwner(petId, userId);
    // 仓储的 WHERE 里带着 pet_id：别的宠物的照片 id 落到这个端点上删不动，报 404。
    if (!(await this.repo.removePhoto(petId, photoId))) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '照片不存在', HttpStatus.NOT_FOUND);
    }
    return { deleted: true };
  }

  /**
   * 写操作前的归属校验。不存在 404，不是自己的 403。
   *
   * 这里刻意**不**用 404 掩盖 403：宠物本来就在广场上公开可见，假装它不存在藏不住
   * 任何信息，只会让主人分不清「是被删了」还是「登错号了」。
   * 归属走 `findOwnerId`（不过滤 visibility）—— 私密宠物的主人也要能改自己的宠物。
   */
  private async assertOwner(petId: string, userId: string): Promise<void> {
    const ownerId = await this.repo.findOwnerId(petId);
    if (ownerId == null) this.notFound();
    if (ownerId !== userId) {
      throw new ApiException(ERROR_CODES.FORBIDDEN, '只能操作自己的宠物', HttpStatus.FORBIDDEN);
    }
  }

  private notFound(): never {
    throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
  }
}

/**
 * 卡片投影。导出给 FollowsService 复用 —— 关注列表和广场页必须是同一形状，
 * 各写一份迟早漂移。
 *
 * `isFollowing` 一律先给 `false`，由 `FollowsService.markFollowing` 批量覆盖：
 * 投影层拿不到登录态，也不该为每张卡去查一次关注关系（N+1）。
 */
export function toSummary(row: PetRow): PetSummary {
  return {
    isFollowing: false,
    id: row.id,
    name: row.name,
    species: row.species,
    breed: row.breed,
    gender: row.gender,
    birthDate: row.birthDate,
    coverUrl: row.coverUrl,
    coverWidth: row.coverWidth,
    coverHeight: row.coverHeight,
    personalityTags: row.personalityTags,
    distanceMeters: row.distanceMeters,
    ownerNickname: row.ownerNickname,
    ownerAvatarUrl: row.ownerAvatarUrl,
    ownerVerified: row.ownerVerified,
  };
}
