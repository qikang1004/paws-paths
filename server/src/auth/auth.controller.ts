import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AdminLoginRateLimitGuard } from '../common/rate-limit/admin-login-rate-limit.guard';
import { LoginRateLimitGuard } from '../common/rate-limit/login-rate-limit.guard';
import {
  AuthService,
  parseAdminLogin,
  type AdminLoginResult,
  type LoginResult,
} from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('wx-login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() body: { code?: string }): Promise<LoginResult> {
    return this.auth.loginWithCode(body?.code ?? '');
  }

  /**
   * 运营后台的账号密码登录。
   *
   * 与 `wx-login` 分开成两个端点而不是给它加个分支：两者的凭据、限流维度与
   * 失败语义都不同（一个是微信 code，一个有可爆破的密码），挤在一处迟早
   * 让某一条的限流套错。
   *
   * `@HttpCode(200)`：登录不创建资源。`wx-login` 那条是历史形状（Nest 默认 201），
   * 这里不跟着错 —— 后台是新写的，没有兼容负担。
   *
   * 刻意**没有**对应的注册端点：运营账号不该能从公网创建。加人走 CLI
   * （`npm run admin:create -w server`），代价是要登服务器，换来的是
   * 「注册入口忘了删」这类事故的概率归零。
   */
  @Post('admin-login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminLoginRateLimitGuard)
  adminLogin(@Body() body: Record<string, unknown>): Promise<AdminLoginResult> {
    // 校验先行：非法入参不该走到仓储去查凭据，也不该消耗限流配额
    // （守卫拿不到用户名时直接放行，正是为了把配额留给真正的爆破尝试）。
    return this.auth.loginWithPassword(parseAdminLogin(body ?? {}));
  }
}
