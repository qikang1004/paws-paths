import { Body, Controller, Get, HttpStatus, Patch, Query, UseGuards } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ApiException } from '../common/api.exception';
import { FollowsService, type FollowListResponse } from '../follows/follows.service';
import { FavoritesService, type FavoriteListResponse } from '../favorites/favorites.service';
import { HistoryService, type ViewHistoryListResponse } from '../history/history.service';
import { parseProfilePatch, UsersService } from '../users/users.service';
import type { UserProfile } from '../users/user.repository';

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
  constructor(
    private readonly follows: FollowsService,
    private readonly history: HistoryService,
    private readonly favorites: FavoritesService,
    private readonly users: UsersService,
  ) {}

  /**
   * 个人中心首屏的全部数据：资料 + 三个计数，一次请求拿完。
   *
   * 端点挂在 MeController 而不是新开 UsersController（计划 Task 8 的原话）：
   * 路径就是 /me，与同目录的 /me/following、/me/favorites 同属「当前用户的数据」，
   * 拆两个 controller 只会让同一个前缀的鉴权与路由散在两处。
   */
  @Get()
  async profile(@CurrentUser() userId: string | null): Promise<UserProfile> {
    return this.users.profile(userId as string);
  }

  @Patch()
  async updateProfile(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<UserProfile> {
    // 校验先行：非法入参不该走到仓储去开事务。
    return this.users.updateProfile(userId as string, parseProfilePatch(body ?? {}));
  }

  @Get('following')
  async following(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<FollowListResponse> {
    return this.follows.listFollowing(userId as string, parseListQuery(q));
  }

  @Get('history')
  async viewHistory(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<ViewHistoryListResponse> {
    // 历史列表不吃坐标（不显示距离），但分页规则与其他列表一致，复用同一套校验。
    const { page, pageSize } = parseListQuery(q);
    return this.history.list(userId as string, { page, pageSize });
  }

  @Get('favorites')
  async favoriteList(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<FavoriteListResponse> {
    // 与历史列表同理：pet/venue 混排的列表项不显示距离，坐标用不上。
    const { page, pageSize } = parseListQuery(q);
    return this.favorites.list(userId as string, { page, pageSize });
  }
}
