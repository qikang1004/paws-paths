import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../common/api.exception';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { FavoritesService } from '../favorites/favorites.service';
import { FollowsService } from '../follows/follows.service';
import { HistoryService } from '../history/history.service';
import {
  PetsService,
  type PetDetail,
  type PetListResponse,
  type PetPhoto,
} from './pets.service';

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
  constructor(
    private readonly pets: PetsService,
    private readonly follows: FollowsService,
    private readonly history: HistoryService,
    private readonly favorites: FavoritesService,
  ) {}

  @Get()
  @UseGuards(OptionalAuthGuard)
  async list(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<PetListResponse> {
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

    const res = await this.pets.list({
      filter: { species, breed },
      page,
      pageSize,
      lat,
      lng,
      radiusMeters,
    });
    // 批量标记，一次查询覆盖整页；未登录时 markFollowing 直接返回不打库。
    return { ...res, items: await this.follows.markFollowing(res.items, userId) };
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async detail(
    @Param('id') id: string,
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<PetDetail> {
    const lat = optionalNumber(q.lat);
    const lng = optionalNumber(q.lng);
    const coords = lat != null && lng != null ? { lat, lng } : undefined;
    const detail = await this.pets.detail(id, { ...coords, viewerId: userId });
    if (!detail) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '宠物不存在', HttpStatus.NOT_FOUND);
    }
    // 404 之后才记：不存在的 id 进历史只会在列表里被投影时丢掉，白占一行。
    // 不 await —— 详情页的延迟与成功率不该绑在浏览历史上。
    this.history.recordSafely(userId, 'pet', id);
    const [marked] = await this.follows.markFollowing([detail], userId);
    // 收藏心标（原型 _2）：未登录时 isFavorite 直接 false，不打库。
    return { ...marked, isFavorite: await this.favorites.isFavorite(userId, 'pet', id) };
  }

  // 关注是幂等的状态设置，不是创建资源：显式 200 而非 Nest 默认的 201
  // （与 venues 的收藏端点一致）。
  @Post(':id/follow')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async follow(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFollowing: boolean }> {
    return this.follows.setFollow(id, userId as string, true);
  }

  @Delete(':id/follow')
  @UseGuards(AuthGuard)
  async unfollow(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFollowing: boolean }> {
    return this.follows.setFollow(id, userId as string, false);
  }

  // 收藏同样是幂等的状态设置：显式 200。与关注的区别是**允许收藏自己的宠物** ——
  // 收藏是个人书签，没有 FOLLOW_SELF 那种「这条关系本来就不该存在」的问题。
  @Post(':id/favorite')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async favorite(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFavorite: boolean }> {
    return this.favorites.setPetFavorite(id, userId as string, true);
  }

  @Delete(':id/favorite')
  @UseGuards(AuthGuard)
  async unfavorite(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ isFavorite: boolean }> {
    return this.favorites.setPetFavorite(id, userId as string, false);
  }

  // ---- 写端点。归属一律在 service 里走 findOwnerId：不存在 404，不是自己的 403。----

  // 这是真的创建资源，所以留 Nest 默认的 201（与上面那几个幂等的状态设置端点相反）。
  @Post()
  @UseGuards(AuthGuard)
  async create(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<{ id: string }> {
    return this.pets.create(userId as string, body ?? {});
  }

  /**
   * 局部更新。同 `MeController.updateProfile`：PATCH 与 PUT 两个动词共用一份
   * 实现，因为 `wx.request` 的 method 白名单里没有 PATCH，小程序端只能发 PUT。
   */
  @Patch(':id')
  @UseGuards(AuthGuard)
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<PetDetail> {
    return this.pets.update(id, userId as string, body ?? {});
  }

  @Put(':id')
  @UseGuards(AuthGuard)
  async put(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<PetDetail> {
    return this.pets.update(id, userId as string, body ?? {});
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  async remove(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ deleted: boolean }> {
    return this.pets.remove(id, userId as string);
  }

  @Post(':id/photos')
  @UseGuards(AuthGuard)
  async addPhoto(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<PetPhoto> {
    return this.pets.addPhoto(id, userId as string, body ?? {});
  }

  @Delete(':id/photos/:photoId')
  @UseGuards(AuthGuard)
  async removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() userId: string | null,
  ): Promise<{ deleted: boolean }> {
    return this.pets.removePhoto(id, photoId, userId as string);
  }
}
