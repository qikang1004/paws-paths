import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import { FollowRepositoryModule } from './follow-repository.module';
import { FollowsService } from './follows.service';

/**
 * 关注域。刻意不带 controller：
 * - `POST/DELETE /pets/:id/follow` 挂在 PetsController 上（路径归宠物资源）
 * - `GET /me/following` 挂在 MeController 上（路径归当前用户）
 *
 * 仓储的工厂搬去 `FollowRepositoryModule` 了：无库模式的关注流要在动态仓储里
 * 问「这个人关注了哪些宠物」，两处各建一个工厂等于两份内存关注关系。
 */
@Module({
  imports: [AuthModule, DatabaseModule, FollowRepositoryModule, PetRepositoryModule],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
