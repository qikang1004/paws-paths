import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ERROR_CODES, type UploadResultDto } from '@paws/types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { ApiException } from '../common/api.exception';
import { MIME_OF, MULTER_HARD_LIMIT_BYTES } from './image-file';
import { UploadsService, type UploadedImage } from './uploads.service';

/** `@Res()` 拿到的是 express 的响应对象。没装 @types/express，只声明这里用得到的三个方法。 */
interface BinaryResponse {
  set(headers: Record<string, string>): void;
  end(data: Buffer): void;
}

/**
 * 待审图片一年缓存 vs 不许缓存：这不是性能取舍。
 *
 * 公开档的 key 里带 uuid，内容永不改变，长缓存加 immutable 是白拿的。
 * 私有档必须 `no-store`：作者本人取得到自己的待审图，中间层（CDN、反向代理、
 * 甚至客户端共享缓存）一旦把这份响应缓存下来，下一个拿到同一 URL 的人就绕过了
 * 「未过审内容对他人不可见」——那是 spec §7 的过审必要条件。
 */
const CACHE_CONTROL = {
  public: 'public, max-age=31536000, immutable',
  private: 'private, no-store',
} as const;

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * 小程序 `wx.uploadFile` 发的是 multipart/form-data：图片在 `file` 字段，
   * 宽高在同一个表单的文本字段里（`wx.chooseMedia` 的回调直接给这两个值）。
   *
   * multer 走内存存储（不给 `storage`/`dest` 时它的默认档）：图片要先过机审才决定
   * 落哪一档，落到临时目录再搬一次纯属多此一举。`limits` 见 MULTER_HARD_LIMIT_BYTES。
   */
  @Post()
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MULTER_HARD_LIMIT_BYTES } }))
  async upload(
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: Record<string, unknown>,
    @CurrentUser() userId: string | null,
  ): Promise<UploadResultDto> {
    return this.uploads.save(userId as string, file, body ?? {});
  }

  /**
   * 取图刻意是控制器路由而不是静态目录：静态中间件没有请求者身份，
   * 做不到「未过审的图对他人 404」。代价是每张图多一次 Node 层的读盘，
   * 阶段 4 换对象存储后公开档可以交给 CDN，私有档仍要走签名 URL 或这条路由。
   */
  @Get(':ownerId/:name')
  @UseGuards(OptionalAuthGuard)
  async serve(
    @Param('ownerId') ownerId: string,
    @Param('name') name: string,
    @CurrentUser() userId: string | null,
    @Res() res: BinaryResponse,
  ): Promise<void> {
    const found = await this.uploads.fetch(`${ownerId}/${name}`, userId);
    if (!found) {
      throw new ApiException(ERROR_CODES.NOT_FOUND, '图片不存在', HttpStatus.NOT_FOUND);
    }
    res.set({
      'Content-Type': MIME_OF[found.ext],
      'Content-Length': String(found.data.length),
      'Cache-Control': CACHE_CONTROL[found.lane],
    });
    res.end(found.data);
  }
}
