import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 参数装饰器：取 guard 挂上的 req.userId，未登录为 null。 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | null => {
    const req = ctx.switchToHttp().getRequest<{ userId?: string | null }>();
    return req.userId ?? null;
  },
);
