import { Body, Controller, Get, Patch, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { parseListQuery } from '../common/list-query';
import { FollowsService, type FollowListResponse } from '../follows/follows.service';
import { FavoritesService, type FavoriteListResponse } from '../favorites/favorites.service';
import { HistoryService, type ViewHistoryListResponse } from '../history/history.service';
import { parseProfilePatch, UsersService } from '../users/users.service';
import { PetsService, type PetSummary } from '../pets/pets.service';
import { PostsService, type PostListResponse } from '../posts/posts.service';
import type { UserProfile } from '../users/user.repository';

/** 形状与 `packages/types` 的 `MyPetListResponse` 一致（刻意不分页）。 */
export interface MyPetListResponse {
  items: PetSummary[];
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
    private readonly pets: PetsService,
    private readonly posts: PostsService,
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

  /**
   * 局部更新资料。**PATCH 与 PUT 是同一个实现**：`wx.request` 的 method
   * 白名单里没有 PATCH（只有 OPTIONS/GET/HEAD/POST/PUT/DELETE/TRACE/CONNECT），
   * 小程序端根本发不出 PATCH。所以给同一份语义挂两个动词 ——
   * PUT 给小程序，PATCH 留给 curl 与后续非小程序端。
   *
   * 两条路由必须共用 `applyPatch`：一旦各写一份校验，「清空头像」这种
   * 靠 `'avatarUrl' in body` 判断的语义迟早只在一个动词上是对的。
   */
  @Patch()
  async updateProfile(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<UserProfile> {
    return this.applyPatch(body, userId);
  }

  @Put()
  async putProfile(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<UserProfile> {
    return this.applyPatch(body, userId);
  }

  private async applyPatch(
    body: Record<string, unknown>,
    userId: string | null,
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

  /**
   * 关注流。路径挂 `/me/feed` 而不是给 `GET /posts` 加一个 `feed=1` 参数：
   * 那个端点是匿名可访问的公开列表、按宠物取，而 feed 要求登录、跨宠物混排、
   * 还刻意排除自己的动态 —— 三条例外挤进去会让它的可见性规则说不清。
   */
  @Get('feed')
  async feed(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<PostListResponse> {
    // feed 不吃坐标（动态不显示距离），但分页规则与其他列表一致，复用同一套校验。
    const { page, pageSize } = parseListQuery(q);
    return this.posts.feed(userId as string, { page, pageSize });
  }

  /**
   * 「我的宠物」。**不分页**（见 `MyPetListResponse` 的注释）—— 发布页选宠物与
   * 「我的动态」按宠物取动态都要完整清单，分页只会逼它们自己拼页。
   *
   * 路径挂 `/me/pets` 而不是给 `GET /pets` 加 `ownerId` 参数：广场那个端点是
   * 匿名可访问的公开列表，塞进「只看某人的、不筛封面、不过滤 visibility」这三条
   * 例外会让它的可见性规则说不清。
   */
  @Get('pets')
  async myPets(@CurrentUser() userId: string | null): Promise<MyPetListResponse> {
    return this.pets.listByOwner(userId as string);
  }
}
