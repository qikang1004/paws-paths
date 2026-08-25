// 由 packages/types 同步而来，禁止手改。
// 改动请改 packages/types，然后跑 npm run sync:types。
import type { AuditStatus } from './audit';
/**
 * 上传成功的回执。
 *
 * `key` 是入库要存的那个值（`post_images.url` / `pet_photos.url` 存的是 `url`，
 * `key` 给需要重新定位这张图的场景留着）；`url` 是可访问地址。
 *
 * 本阶段的 `url` 是**相对路径**（`/uploads/<key>`）：存相对路径意味着换域名不用洗库，
 * 阶段 4 换对象存储后会变成绝对 URL，所以客户端两种都要能认 —— 以 `http` 开头的直接用，
 * 否则拼在接口 base 上。
 *
 * `auditStatus` 只会是 `approved`（机审通过）或 `pending`（还没有结论，含本地假实现那档）。
 * `pending` 的图**只有作者本人取得到**，别人拿这个 URL 得到 404，所以客户端该给它挂
 * 「审核中」角标而不是当成上传失败。
 */
export interface UploadResultDto {
    key: string;
    url: string;
    width: number;
    height: number;
    auditStatus: AuditStatus;
}
