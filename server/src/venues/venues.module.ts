import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { DatabaseModule, PG_POOL } from '../database/database.module';
import {
  InMemoryVenueRepository,
  PostgresVenueRepository,
  VENUE_REPOSITORY,
} from './venue.repository';

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: VENUE_REPOSITORY,
      useFactory: (pool: Pool | null) =>
        pool ? new PostgresVenueRepository(pool) : new InMemoryVenueRepository(),
      inject: [PG_POOL],
    },
  ],
  exports: [VENUE_REPOSITORY],
})
export class VenuesModule {}
