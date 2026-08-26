import type { PublishPostBody } from '../../../../api/posts';

/**
 * 发布页的纯逻辑：上限、字数、校验、入参装配。
 *
 * 上限与提示文案跟服务端 `parsePostCreate` 一字对齐。客户端这一道只为省一次白跑的
 * 请求，服务端那道才是边界 —— 但两边文案不一致时，用户会看着「250/500」被拒。
 */

/** 与服务端 `POST_CONTENT_MAX_LENGTH` 同值。按**码点**数，不是 UTF-16 长度。 */
export const POST_CONTENT_MAX_LENGTH = 500;

/** 与服务端 `POST_IMAGES_MAX_COUNT` 同值。 */
export const POST_IMAGES_MAX_COUNT = 9;

/** 表单里的一张图。`auditStatus` 之类的多余字段允许存在，装配时会被摘掉。 */
export interface ComposeImage {
  url: string;
  width: number;
  height: number;
}

export interface PostForm {
  petId: string;
  content: string;
  images: ComposeImage[];
}

/**
 * 码点数。`'🐶'.length === 2`，用 `.length` 卡会让「500 字」对爱用 emoji 的人
 * 变成 250 个，而服务端按码点放行 —— 那就是客户端先拦住了服务端允许的内容。
 */
export function countChars(value: string): number {
  return [...value].length;
}

export interface ValidationResult {
  ok: boolean;
  message: string;
}

const ok: ValidationResult = { ok: true, message: '' };
const bad = (message: string): ValidationResult => ({ ok: false, message });

export function validatePostForm(form: PostForm): ValidationResult {
  if (!form.petId) return bad('先选一只宠物');
  const content = form.content.trim();
  if (content.length === 0) return bad('说点什么再发吧');
  if (countChars(content) > POST_CONTENT_MAX_LENGTH) {
    return bad(`动态内容不能超过 ${POST_CONTENT_MAX_LENGTH} 字`);
  }
  if (form.images.length > POST_IMAGES_MAX_COUNT) {
    return bad(`最多只能发 ${POST_IMAGES_MAX_COUNT} 张图`);
  }
  return ok;
}

/**
 * 表单 → 发布入参。
 *
 * 图片只带 `url` 与宽高：上传接口回过一个 `auditStatus`，但那是给页面看的，
 * 发回服务端等于让发布方自己声明「我这张图过审了」（`api/posts.ts` 已说明服务端
 * 一概不读）。少发一个字段，就少一处让人误以为它有用的地方。
 */
export function toPublishBody(form: PostForm): PublishPostBody {
  return {
    petId: form.petId,
    content: form.content.trim(),
    images: form.images.map((image) => ({
      url: image.url,
      width: image.width,
      height: image.height,
    })),
  };
}
