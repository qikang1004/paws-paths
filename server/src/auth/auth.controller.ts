import { Body, Controller, Post } from '@nestjs/common';
import { AuthService, type LoginResult } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('wx-login')
  login(@Body() body: { code?: string }): Promise<LoginResult> {
    return this.auth.loginWithCode(body?.code ?? '');
  }
}
