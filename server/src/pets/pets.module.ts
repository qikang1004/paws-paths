import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FavoritesModule } from '../favorites/favorites.module';
import { FollowsModule } from '../follows/follows.module';
import { HistoryModule } from '../history/history.module';
import { UploadsModule } from '../uploads/uploads.module';
import { PetRepositoryModule } from './pet-repository.module';
import { PetsController } from './pets.controller';
import { PetsService } from './pets.service';

@Module({
  // UploadsModule：加照片时按文件所在的档定审核状态（UploadsService.laneOfUrl）。
  imports: [
    AuthModule,
    PetRepositoryModule,
    FollowsModule,
    HistoryModule,
    FavoritesModule,
    UploadsModule,
  ],
  controllers: [PetsController],
  providers: [PetsService],
  exports: [PetsService],
})
export class PetsModule {}
