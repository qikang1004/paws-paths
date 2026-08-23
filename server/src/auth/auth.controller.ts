import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { LoginRateLimitGuard } from '../common/rate-limit/login-rate-limit.guard';
import { AuthService, type LoginResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('wx-login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() body: { code?: string }): Promise<LoginResult> {
    return this.auth.loginWithCode(body?.code ?? '');
  }
}
