import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FavoritesModule } from '../favorites/favorites.module';
import { FollowsModule } from '../follows/follows.module';
import { HistoryModule } from '../history/history.module';
import { PetsModule } from '../pets/pets.module';
import { UsersModule } from '../users/users.module';
import { MeController } from './me.controller';

/** 个人中心：关注列表、浏览历史、收藏、资料、我的宠物。端点全部要求登录。 */
@Module({
  // PetsModule 只为 `GET /me/pets` 借一个 PetsService（它 exports 了）。
  // 导入模块不会重复注册它的 controller，所以 /pets 那批路由不会挂第二遍。
  imports: [AuthModule, FollowsModule, HistoryModule, FavoritesModule, UsersModule, PetsModule],
  controllers: [MeController],
})
export class MeModule {}
