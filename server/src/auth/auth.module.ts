import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [WechatModule, UsersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
