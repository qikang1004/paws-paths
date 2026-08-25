import { API_BASE_URL } from '../config';

/**
 * 图片地址补全。三种形态都要认，因为它们真的都会出现：
 *
 * - `/uploads/<key>` —— 本阶段服务端返的就是相对路径（存相对路径意味着换域名不用洗库）。
 * - `https://…` —— 阶段 4 换对象存储后的形态，原样用。
 * - `wxfile://…` —— `wx.chooseMedia` 给的本地临时文件，发布页要在上传前先预览。
 *
 * 空值回空串而不是抛错：wxml 里 `wx:if="{{url}}"` 就能整块不渲染，
 * 而一个拼歪的 URL 只会在真机上留下一个碎图标。
 */
export function resolveImageUrl(
  url: string | null | undefined,
  baseUrl: string = API_BASE_URL,
): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  // 不以 `/` 开头的一律当本地临时路径（wxfile:// 之类），不去拼 base。
  if (!url.startsWith('/')) return url;
  return `${baseUrl.replace(/\/+$/, '')}${url}`;
}
