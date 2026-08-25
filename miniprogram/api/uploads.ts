import type { UploadResultDto } from '../shared/types/index';
import { api } from './client';
import type { ApiClient } from './request';

/**
 * 上传一张图。
 *
 * 宽高必传（Global Constraint 21）：瀑布流要靠它在图片加载前算占位高度。
 * 页面从 `wx.chooseMedia` 的返回里拿真实宽高，不要自己估。
 *
 * 回执里的 `auditStatus` 只会是 `approved` 或 `pending`。`pending` 的图**只有作者
 * 本人取得到**，别人拿这个 URL 会得到 404 —— 所以该给它挂「审核中」角标，
 * 而不是当成上传失败重试。
 */
export interface UploadImageParams {
  filePath: string;
  width: number;
  height: number;
}

export async function uploadImage(
  params: UploadImageParams,
  client: ApiClient = api,
): Promise<UploadResultDto> {
  return client.upload<UploadResultDto>('/uploads', {
    filePath: params.filePath,
    name: 'file',
    // multipart 的字段一律是字符串，服务端的 parseDimension 也只收字符串。
    formData: { width: String(params.width), height: String(params.height) },
  });
}
