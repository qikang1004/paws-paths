import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ADMIN_LOGIN_RATE_LIMIT, RateLimiterService } from './rate-limit.service';

/**
 * 运营登录限流：**同时按用户名与 IP 计数，两条都要**。
 *
 * 这是密码登录与微信登录最实质的区别 —— 后者压根没有可爆破的凭据，
 * 而这里有。缺任何一条就留一个绕过口：
 *   · 只按用户名：攻击者换用户名就绕过（顺带还能无限枚举用户名）；
 *   · 只按 IP：分布式爆破换 IP 就绕过，而且同一出口的正常运营会被连坐。
 *
 * 键控用**请求里的用户名**而不是解析后的用户 id：用户名不存在时也必须计数，
 * 否则「猜用户名」这一步完全不受限，攻击者可以先枚举出存在的账号再下手。
 *
 * 守卫**不读密码**，也不碰凭据 —— 它只看 `username` 那一格。校验由
 * `parseAdminLogin` 在服务层做，所以这里拿不到用户名时直接放行：
 * 那种请求接下来必然是 422，不该消耗配额（非法入参不是爆破尝试）。
 */
@Injectable()
export class AdminLoginRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiterService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      body?: { username?: unknown };
    }>();
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    // 拿不到用户名：交给服务层的 422，不计数。
    if (!username) return true;

    // 两条都查。哪条先超限都一样是 429 —— 调用方不需要知道是哪一条。
    await this.limiter.check(`admin-login:user:${username}`, ADMIN_LOGIN_RATE_LIMIT);
    await this.limiter.check(`admin-login:ip:${req.ip ?? 'unknown'}`, ADMIN_LOGIN_RATE_LIMIT);
    return true;
  }
}
