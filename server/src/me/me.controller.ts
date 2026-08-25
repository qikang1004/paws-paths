import { Controller, Get, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiException } from '../common/api.exception';
import { FollowsService, type FollowListResponse } from '../follows/follows.service';

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

function optionalNumber(raw: string | undefined): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** 分页与坐标的入参校验，与 PetsController 同一套规则。 */
export function parseListQuery(q: Record<string, string | undefined>): {
  page: number;
  pageSize: number;
  lat?: number;
  lng?: number;
} {
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
  return { page, pageSize, lat, lng };
}

/**
 * 当前用户的个人数据。整个 controller 都在 AuthGuard 后面 ——
 * 这里没有一个端点是能匿名访问的，逐个方法加装饰器只会漏。
 */
@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly follows: FollowsService) {}

  @Get('following')
  async following(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<FollowListResponse> {
    return this.follows.listFollowing(userId as string, parseListQuery(q));
  }
}
