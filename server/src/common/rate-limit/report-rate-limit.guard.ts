import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@paws/types';
import { ApiException } from '../api.exception';
import { REPORT_RATE_LIMIT, RateLimiterService } from './rate-limit.service';

/**
 * 举报端点限流：**按 userId 键控**，一小时 10 次（`REPORT_RATE_LIMIT`）。
 *
 * 与 `LoginRateLimitGuard` 的关键差别是键控维度。举报要求登录，而滥用的单位是
 * **账号**：
 *   · 按 IP 限会连坐 —— 同一出口 IP 后面可能是整个校园网或办公室；
 *   · 按 IP 也拦不住真想刷的人 —— 换 IP 对一个账号来说太容易了。
 * 登录端点没有这个选择（那时还没有身份），所以它只能按 IP。
 *
 * 用法一律是 `@UseGuards(AuthGuard, ReportRateLimitGuard)`：`AuthGuard` 先跑并挂好
 * `req.userId`。顺序反了会走到下面那个 401 —— 那时限流**不计数**，
 * 否则匿名请求能把某个键刷爆。
 */
@Injectable()
export class ReportRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ userId?: string | null }>();
    const userId = req.userId;
    // 没有 userId 说明 AuthGuard 没挂在前面 —— 那是配线错误。按 401 处理并且
    // **不计数**：拼不出账号维度的键，退回按 IP 计只会让这条限流变成连坐。
    if (!userId) {
      throw new ApiException(ERROR_CODES.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
    }
    await this.limiter.check(`report:${userId}`, REPORT_RATE_LIMIT);
    return true;
  }
}
