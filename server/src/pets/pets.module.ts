import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  InMemoryPetRepository,
  PET_REPOSITORY,
  PostgresPetRepository,
} from './pet.repository';
import { PetsController } from './pets.controller';
import { PetsService } from './pets.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [PetsController],
  providers: [
    {
      provide: PET_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresPetRepository(pool) : new InMemoryPetRepository(),
      inject: [PG_POOL],
    },
    PetsService,
  ],
  exports: [PetsService],
})
export class PetsModule {}
