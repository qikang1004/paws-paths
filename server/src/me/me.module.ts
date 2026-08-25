import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FollowsModule } from '../follows/follows.module';
import { HistoryModule } from '../history/history.module';
import { MeController } from './me.controller';

/** 个人中心：关注列表、浏览历史、收藏、资料。端点全部要求登录。 */
@Module({
  imports: [AuthModule, FollowsModule, HistoryModule],
  controllers: [MeController],
})
export class MeModule {}
