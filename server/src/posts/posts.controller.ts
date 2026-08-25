import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ERROR_CODES, type PostDto } from '@paws/types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentOpenid } from '../auth/current-openid.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ApiException } from '../common/api.exception';
import { parseListQuery } from '../common/list-query';
import { parsePostCreate, PostsService, type PostListResponse } from './posts.service';

/**
 * 动态。读接口挂 `OptionalAuthGuard` —— 未登录也能看别人过审的动态，
 * 登录了才多看见自己那些待审/被驳回的（可见性判定在服务层，见 `isVisibleTo`）。
 */
@Controller('posts')
export class PostsController {
  constructor(private readonly posts: PostsService) {}

  /**
   * 发布。`openid` 取自验过签的令牌而不是请求体：内容安全接口要求带上发内容
   * 那个人的 openid，让客户端自己报等于让人替别人过审。
   */
  @Post()
  @UseGuards(AuthGuard)
  async publish(
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
    @CurrentOpenid() openid: string | null,
  ): Promise<PostDto> {
    return this.posts.publish(userId as string, openid, parsePostCreate(body ?? {}));
  }

  /**
   * 某只宠物的动态列表。`petId` 必填：全局信息流本阶段没有消费者，
   * 留一个没人调的分支只会让它悄悄跑偏（YAGNI）。
   */
  @Get()
  @UseGuards(OptionalAuthGuard)
  async list(
    @Query() q: Record<string, string | undefined>,
    @CurrentUser() userId: string | null,
  ): Promise<PostListResponse> {
    const petId = (q.petId ?? '').trim();
    if (!petId) {
      throw new ApiException(
        ERROR_CODES.VALIDATION_FAILED,
        '缺少宠物 id',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // 动态列表不显示距离（卡片上是宠物名 + 时间），坐标用不上，但分页规则与
    // 其他列表一致，复用同一套校验。
    const { page, pageSize } = parseListQuery(q);
    return this.posts.list(petId, userId, { page, pageSize });
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async detail(
    @Param('id') id: string,
    @CurrentUser() userId: string | null,
  ): Promise<PostDto> {
    return this.posts.detail(id, userId);
  }
}
