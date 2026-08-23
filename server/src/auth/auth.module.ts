import { Module } from '@nestjs/common';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { UsersModule } from '../users/users.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  imports: [WechatModule, UsersModule, RateLimitModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OptionalAuthGuard],
  exports: [AuthGuard, OptionalAuthGuard],
})
export class AuthModule {}
