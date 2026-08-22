import { Controller, Get, HttpStatus, Param, Query, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { PetsService, type PetDetail, type PetListResponse } from './pets.service';

const VALID_SPECIES: ReadonlySet<string> = new Set(['all', 'dog', 'cat', 'other']);

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

@Controller('pets')
export class PetsController {
  constructor(private readonly pets: PetsService) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  async list(@Query() q: Record<string, string | undefined>): Promise<PetListResponse> {
    const species = q.species ?? 'all';
    if (!VALID_SPECIES.has(species)) fail('非法的物种筛选');

    const breed = (q.breed ?? 'all').trim();
    if (!breed) fail('非法的品种筛选');

    const page = optionalNumber(q.page) ?? 1;
    if (!Number.isInteger(page) || page < 1) fail('非法的页码');

    const pageSize = optionalNumber(q.pageSize) ?? 10;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) fail('非法的页大小');

    const lat = optionalNumber(q.lat);
    const lng = optionalNumber(q.lng);
    if (lat == null !== (lng == null)) fail('经纬度必须成对提供');
    if (lat != null && (lat < -90 || lat > 90 || (lng as number) < -180 || (lng as number) > 180)) {
      fail('非法坐标');
    }

    const radiusMeters = optionalNumber(q.radiusMeters);
    if (radiusMeters != null && (radiusMeters < 1 || radiusMeters > 50_000)) {
      fail('非法的搜索半径');
    }

    return this.pets.list({ filter: { species, breed }, page, pageSize, lat, lng, radiusMeters });
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async detail(
    @Param('id') id: string,
    @Query() q: Record<string, string | undefined>,
  ): Promise<PetDetail> {
    const lat = optionalNumber(q.lat);
    const lng = optionalNumber(q.lng);
    const coords = lat != null && lng != null ? { lat, lng } : undefined;
    const detail = await this.pets.detail(id, coords);
    if (!detail) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    return detail;
  }
}
