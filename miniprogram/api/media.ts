import type { AuditStatus } from '../shared/types/index';
import { api } from './client';
import type { PostImageInput } from './posts';
import type { ApiClient } from './request';
import { uploadImage } from './uploads';
import { wxAdapter, type WxAdapter } from './wx-promise';

/**
 * 选图 + 上传，一步到位。发布动态与宠物照片两条路都走这里。
 *
 * 为什么不让页面自己调 `wx.chooseMedia`：宽高必须从 chooseMedia 的返回里原样带到
 * 上传接口（Global Constraint 21，服务端缺宽高直接 422），页面各写一遍迟早有人
 * 用图片的显示尺寸凑数。选图这一步经 `WxAdapter` 走，所以这段逻辑是可测的。
 */

/** 服务端的业务上限（`MAX_UPLOAD_BYTES`）。客户端先挡一道，省一次白跑的上传。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface UploadedImage extends PostImageInput {
  auditStatus: AuditStatus;
}

export interface PickAndUploadResult {
  images: UploadedImage[];
  /** 被本地规则挡下的张数（尺寸读不到、体积超限）。页面据此提示「N 张图没传上去」。 */
  skipped: number;
  /** 用户点了取消。与「选了图但全被挡下」不是一回事，后者要提示，前者不该弹任何东西。 */
  canceled: boolean;
}

export interface PickAndUploadDeps {
  wx?: WxAdapter;
  client?: ApiClient;
}

/**
 * 选最多 `count` 张图并逐张上传，返回可直接塞进 `publishPost` 的 `images`。
 *
 * **逐张顺序上传**而不是 `Promise.all`：小程序对并发请求有队列上限，一次并发十张
 * 会把后面的请求挤掉；顺序上传还能让页面按 `images.length` 显示进度。
 *
 * 已经传上去的不会因为后一张失败而丢 —— 抛错前先把成功的部分记进异常没有意义，
 * 所以这里让失败的那张连带后面的一起终止，由页面重试（重试只会重传剩下的）。
 */
export async function pickAndUploadImages(
  count: number,
  deps: PickAndUploadDeps = {},
): Promise<PickAndUploadResult> {
  const wx = deps.wx ?? wxAdapter;
  const client = deps.client ?? api;

  let files;
  try {
    files = await wx.chooseMedia(count);
  } catch {
    // 用户点「取消」也走 fail 回调，wx 不给可区分的错误码。一律当成取消：
    // 真的失败了页面也没有可执行的补救动作，弹「选图失败」只是噪声。
    return { images: [], skipped: 0, canceled: true };
  }

  const images: UploadedImage[] = [];
  let skipped = 0;
  for (const file of files) {
    // 宽高是非可选列（Global Constraint 21）。chooseMedia 理论上一定给，
    // 但真机上偶有 0 —— 那种图宁可不传，也不能编一个尺寸糊过服务端校验。
    if (!(file.width > 0) || !(file.height > 0)) {
      skipped += 1;
      continue;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      skipped += 1;
      continue;
    }
    const result = await uploadImage(
      { filePath: file.tempFilePath, width: file.width, height: file.height },
      client,
    );
    images.push({
      url: result.url,
      width: result.width,
      height: result.height,
      auditStatus: result.auditStatus,
    });
  }
  return { images, skipped, canceled: false };
}
