import { Module } from '@nestjs/common';
import { RateLimitModule } from '../common/rate-limit/rate-limit.module';
import { UsersModule } from '../users/users.module';
import { WechatModule } from '../wechat/wechat.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { ModeratorGuard } from './moderator.guard';
import { OptionalAuthGuard } from './optional-auth.guard';

@Module({
  imports: [WechatModule, UsersModule, RateLimitModule],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, OptionalAuthGuard, ModeratorGuard],
  // 连 `UsersModule` 一起再导出（模块级 re-export）。
  //
  // 守卫是**宿主模块**的 injectable：`@UseGuards(AuthGuard, ModeratorGuard)` 写在
  // 谁的 controller 上，Nest 就在谁的注入上下文里造这两个实例。`AuthGuard` 没有依赖
  // 所以一直没人察觉，而 `ModeratorGuard` 要 `USER_REPOSITORY` —— 不 re-export 的话
  // 每个挂运营端点的模块都得自己 import 一遍 `UsersModule`，漏一个就是启动时才炸。
  exports: [AuthGuard, OptionalAuthGuard, ModeratorGuard, UsersModule],
})
export class AuthModule {}
