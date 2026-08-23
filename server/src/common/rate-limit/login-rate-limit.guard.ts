import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { RateLimiterService } from './rate-limit.service';

/** 登录端点限流：按客户端 IP 键控固定窗口，超限抛 429 + RATE_LIMITED。 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ ip?: string }>();
    await this.limiter.check(`login:${req.ip ?? 'unknown'}`);
    return true;
  }
}
