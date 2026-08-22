import { Module } from '@nestjs/common';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { UsersModule } from '../users/users.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [WechatModule, UsersModule, RateLimitModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
