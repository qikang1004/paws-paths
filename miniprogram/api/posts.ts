import type { PostDto } from '../shared/types/index';
import { api } from './client';
import type { PagedResponse, PageParams } from './paged';
import type { ApiClient } from './request';

/** 发布时带的一张图。宽高必填（Global Constraint 21），由 `api/media.ts` 从选图结果原样带过来。 */
export interface PostImageInput {
  url: string;
  width: number;
  height: number;
}

/** 发布入参。图片可省 —— 只发文字是最常见的用法。 */
export interface PublishPostBody {
  petId: string;
  content: string;
  images?: PostImageInput[];
}

export interface FetchPostsParams extends PageParams {
  petId: string;
}

/**
 * 发布动态。
 *
 * 响应的 `auditStatus` **恒为 `pending`**：机审在服务端异步跑，不阻塞这次请求。
 * 页面因此该直接挂上「审核中」角标，而不是等一个 `approved` 再刷新。
 *
 * 图片的 `auditStatus` 不在入参里 —— 服务端按图片实际落的存储档位反查，
 * 客户端报什么都不读（否则等于让发布方自己声明「我这张图过审了」）。
 */
export async function publishPost(
  body: PublishPostBody,
  client: ApiClient = api,
): Promise<PostDto> {
  return client.call<PostDto>('/posts', {
    method: 'POST',
    // 显式补空数组：漏掉这个 key 会让 JSON 里根本没有 images 字段，
    // 服务端虽然也当空处理，但「没传」和「传了空」在排查时是两回事。
    data: { petId: body.petId, content: body.content, images: body.images ?? [] },
  });
}

/** 某只宠物的动态列表。`petId` 必填 —— 服务端没有全局信息流（本阶段无消费者）。 */
export async function fetchPosts(
  params: FetchPostsParams,
  client: ApiClient = api,
): Promise<PagedResponse<PostDto>> {
  return client.call<PagedResponse<PostDto>>('/posts', { data: params });
}

/** 详情。看不见的动态服务端回 404（不是 403 —— 免得响应码本身泄露「这条存在」）。 */
export async function fetchPostDetail(id: string, client: ApiClient = api): Promise<PostDto> {
  return client.call<PostDto>(`/posts/${id}`);
}
