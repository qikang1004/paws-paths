import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * 参数装饰器：取 `AuthGuard` 从令牌里挂上的 req.openid。
 *
 * 微信内容安全 `msgSecCheck` v2 要求带上发内容那个人的 openid。它已经在
 * 已验签的 JWT 里，所以这里既不查库也不信请求体 —— 客户端报的 openid
 * 等于让人替别人过审。老令牌（阶段 0 签发时未带 openid）为 null，
 * 调用方按「拿不到就不调，内容留待审」处理（fail-closed）。
 */
export const CurrentOpenid = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<{ openid?: string | null }>();
    return req.openid ?? null;
  },
);
