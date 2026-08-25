import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import { PetRepositoryModule } from '../pets/pet-repository.module';
import { VenueRepositoryModule } from '../venues/venue-repository.module';
import {
  FAVORITES_REPOSITORY,
  InMemoryFavoritesRepository,
  PostgresFavoritesRepository,
} from './favorite.repository';
import { FavoritesService } from './favorites.service';

/**
 * 收藏是跨域的（宠物 + 场所），所以仓储从阶段 1 的 src/venues 搬到这里。
 *
 * 只 import 两个「仓储专用模块」而不是 PetsModule / VenuesModule：那两个模块
 * 反过来要用 FavoritesService 打心标，直接互相 import 就是循环。
 * 与 FollowsModule / HistoryModule 同款打法。
 *
 * 同时导出 FAVORITES_REPOSITORY：VenuesService 的 applyFavorites 直接用仓储做
 * 批量标记，不必为此绕一层 service。
 */
@Module({
  imports: [DatabaseModule, PetRepositoryModule, VenueRepositoryModule],
  providers: [
    {
      provide: FAVORITES_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresFavoritesRepository(pool) : new InMemoryFavoritesRepository(),
      inject: [PG_POOL],
    },
    FavoritesService,
  ],
  exports: [FAVORITES_REPOSITORY, FavoritesService],
})
export class FavoritesModule {}
