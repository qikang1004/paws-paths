import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';
import {
  InMemoryPetRepository,
  PET_REPOSITORY,
  PostgresPetRepository,
} from './pet.repository';
import { PetsService } from './pets.service';

@Module({
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
