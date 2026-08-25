import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import {
  PET_REPOSITORY,
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
}

export interface PetListResponse {
  items: PetSummary[];
  hasMore: boolean;
  page: number;
}

const VALID_SPECIES: ReadonlySet<string> = new Set(['all', 'dog', 'cat', 'other']);

@Injectable()
export class PetsService {
  constructor(@Inject(PET_REPOSITORY) private readonly repo: PetRepository) {}

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

  async detail(id: string, opts?: { lat?: number; lng?: number }): Promise<PetDetail | null> {
    const coords =
      opts && typeof opts.lat === 'number' && typeof opts.lng === 'number'
        ? { lat: opts.lat, lng: opts.lng }
        : undefined;
    const found = await this.repo.getById(id, coords);
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
    };
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
