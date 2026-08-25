import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type UploadResultDto } from '@paws/types';
import { ApiException } from '../common/api.exception';
import {
  CONTENT_SECURITY_API,
  type ContentSecurityApi,
  type ContentSecurityVerdict,
} from '../moderation/content-security';
import {
  MAX_UPLOAD_BYTES,
  parseDimension,
  sniffImageType,
  type ImageExt,
} from './image-file';
import { IMAGE_STORAGE, parseImageKey, type ImageStorage, type StorageLane } from './image-storage';

/** multer 内存存储塞进 `req.file` 的形状，只声明用得到的字段（没装 @types/multer，也不为此装）。 */
export interface UploadedImage {
  buffer?: Buffer;
  size?: number;
  originalname?: string;
}

export interface ServedImage {
  data: Buffer;
  ext: ImageExt;
  lane: StorageLane;
}

/**
 * 裁决到存储档位的映射。查表而不是逐个比较状态字面量：
 * 那种写法会被 `test/audit-literal-guard.spec.ts` 拦下（spec §4.5 要求状态机唯一），
 * 而查表顺带把「将来多一种裁决」变成编译错误而不是静默漏判。
 * （连举例都不能把那个写法抄在注释里 —— 守卫是纯文本扫描，分不清代码和注释。）
 *
 * `rejected` 映到 null：微信已经明确判定违规的图，一个字节都不该落盘 ——
 * 存下来只是给自己留一份将来可能被误发出去的违规内容。
 */
const LANE_OF: Readonly<Record<ContentSecurityVerdict, StorageLane | null>> = {
  approved: 'public',
  pending: 'private',
  rejected: null,
};

/** 取图的对外 URL 前缀，与 `save()` 拼出来的那个保持一处定义。 */
const URL_PREFIX = '/uploads/';

function fail(message: string): never {
  throw new ApiException(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY);
}

@Injectable()
export class UploadsService {
  constructor(
    @Inject(IMAGE_STORAGE) private readonly storage: ImageStorage,
    @Inject(CONTENT_SECURITY_API) private readonly security: ContentSecurityApi,
  ) {}

  /**
   * 校验 → 机审 → 落盘。机审在落盘**之前**：先写再删的话，中间任何一次崩溃都会
   * 在盘上留下一张没人知道该不该发的图。
   */
  async save(
    ownerId: string,
    file: UploadedImage | undefined,
    fields: Record<string, unknown>,
  ): Promise<UploadResultDto> {
    const data = file?.buffer;
    if (!data || data.length === 0) fail('请选择要上传的图片');

    // Global Constraint 21：宽高是瀑布流的预估高度，缺了整个列表会在图片加载时跳版。
    const width = parseDimension(fields.width);
    const height = parseDimension(fields.height);
    if (width == null || height == null) fail('必须提供图片的真实宽高');

    if (data.length > MAX_UPLOAD_BYTES) {
      fail(`图片不能超过 ${Math.floor(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
    }

    const ext = sniffImageType(data);
    if (!ext) fail('只能上传 JPG / PNG / GIF / WEBP 图片');

    const verdict = await this.security.checkImage({ data, filename: file?.originalname });
    const lane = LANE_OF[verdict];
    if (!lane) {
      throw new ApiException(
        ERROR_CODES.AUDIT_REJECTED,
        '这张图片未通过审核',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    const key = await this.storage.put({ lane, ownerId, ext, data });
    return { key, url: `${URL_PREFIX}${key}`, width, height, auditStatus: verdict };
  }

  /**
   * 反查一个图片地址落在哪一档。不是本服务发出的地址（外链、拼错的 key、
   * 已经不存在的文件）一律返回 null。
   *
   * 发动态时用它来定图片的审核状态：客户端报的 `auditStatus` 不能信 ——
   * 那等于让发布方自己声明「我这张图过审了」。档位是机审当时落的，是唯一的真相。
   */
  async laneOfUrl(url: string): Promise<StorageLane | null> {
    if (!url.startsWith(URL_PREFIX)) return null;
    const key = url.slice(URL_PREFIX.length);
    if (!parseImageKey(key)) return null;
    return this.storage.locate(key);
  }

  /**
   * 取图。返回 null 一律由调用方转成 404 —— 「不存在」和「存在但你无权看」对外
   * 必须是同一个响应，否则 404/403 的差别本身就把「这个 key 有东西」告诉了探测者。
   */
  async fetch(key: string, requesterId: string | null): Promise<ServedImage | null> {
    const parsed = parseImageKey(key);
    if (!parsed) return null;

    const lane = await this.storage.locate(key);
    if (!lane) return null;
    // 私有档只对作者本人开放。key 的第一段就是作者 id，不必回表查。
    if (lane === 'private' && requesterId !== parsed.ownerId) return null;

    return { data: await this.storage.read(key, lane), ext: parsed.ext, lane };
  }
}
