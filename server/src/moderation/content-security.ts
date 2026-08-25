import type { AuditStatus } from '@paws/types';

/**
 * DI 令牌：内容安全接口。与 `WECHAT_SESSION_API` 同一套 seam ——
 * 业务代码只认这个令牌，真假实现由 `ModerationModule` 的工厂按环境变量选。
 */
export const CONTENT_SECURITY_API = 'ContentSecurityApi';

/**
 * 检查结论。刻意收窄到审核状态机的三个值里，让调用方能直接落库：
 *
 * - `approved`：机器判定通过
 * - `rejected`：命中违规
 * - `pending`：**没有结论** —— 假实现、机器不敢判（`suggest: 'review'`）、
 *   或者调用本身失败了。一律留在待审，对他人不可见。
 *
 * 不含 `pending_review`：那是「已公开的内容被举报后撤下复核」，
 * 这里的内容还没公开过。
 */
export type ContentSecurityVerdict = Extract<AuditStatus, 'approved' | 'rejected' | 'pending'>;

/** `msgSecCheck` v2 的场景值。动态发布属社交日志（4）。 */
export type ContentSecurityScene = 1 | 2 | 3 | 4;

export interface TextCheckInput {
  content: string;
  /** v2 强制要求：必须是近两小时内在本小程序有过访问的用户的 openid。 */
  openid: string;
  scene?: ContentSecurityScene;
}

export interface ImageCheckInput {
  /** 图片二进制。`imgSecCheck` 只收 multipart 的 media 字段，不收 URL。 */
  data: Buffer;
  filename?: string;
}

export interface ContentSecurityApi {
  checkText(input: TextCheckInput): Promise<ContentSecurityVerdict>;
  checkImage(input: ImageCheckInput): Promise<ContentSecurityVerdict>;
}

/**
 * 是否跳过真实的内容安全调用。只认字面 `'1'`（同 `shouldFakeWechatLogin`）。
 *
 * 开着它等于所有 UGC 都停在 `pending`：链路能跑通，但没有任何内容会自动过审。
 * 这是有意的取向 —— 见 `FakeContentSecurityApi` 的注释。
 */
export function shouldFakeContentSecurity(raw: string | undefined): boolean {
  return raw === '1';
}
