import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { HistoryService } from '../history/history.service';
import type { VenueCategory } from './venue.repository';
import { VenuesService, type Venue } from './venues.service';

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'all',
  'hospital',
  'shop',
  'grooming',
  'park',
  'cafe',
  'other',
]);

const MAX_KEYWORD_LENGTH = 50;

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

@Controller('venues')
export class VenuesController {
  constructor(
    private readonly venues: VenuesService,
    private readonly history: HistoryService,
  ) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  async list(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<Venue[]> {
    const category = q.category ?? 'all';
    if (!VALID_CATEGORIES.has(category)) fail('非法的类目筛选');

    const keyword = (q.keyword ?? '').trim();
    if (keyword.length > MAX_KEYWORD_LENGTH) fail('关键词过长');

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

    return this.venues.search({
      keyword: keyword === '' ? undefined : keyword,
      category: category as 'all' | VenueCategory,
      lat,
      lng,
      radiusMeters,
      userId,
    });
  }

  @Get(':poiId')
  @UseGuards(OptionalAuthGuard)
  async detail(
    @Param('poiId') poiId: string,
    @CurrentUser() userId: string | null,
  ): Promise<Venue> {
    const venue = await this.venues.detail(poiId, userId);
    if (!venue) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '场所不存在', HttpStatus.NOT_FOUND);
    }
    // 与宠物详情同款：404 之后才记，且不 await（失败只写日志）。
    this.history.recordSafely(userId, 'venue', poiId);
    return venue;
  }

  // 收藏是幂等的状态设置，不是创建资源：显式 200 而非 Nest 默认的 201
  @Post(':poiId/favorite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async addFavorite(
    @Param('poiId') poiId: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFavorite: boolean }> {
    return this.venues.setFavorite(poiId, userId as string, true);
  }

  @Delete(':poiId/favorite')
  @UseGuards(AuthGuard)
  async removeFavorite(
    @Param('poiId') poiId: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFavorite: boolean }> {
    return this.venues.setFavorite(poiId, userId as string, false);
  }
}
