import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parseListQuery } from '../common/list-query';
import { FollowsService, type FollowListResponse } from '../follows/follows.service';
import { FavoritesService, type FavoriteListResponse } from '../favorites/favorites.service';
import { HistoryService, type ViewHistoryListResponse } from '../history/history.service';
import { parseProfilePatch, UsersService } from '../users/users.service';
import type { UserProfile } from '../users/user.repository';

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
