import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { PetsModule } from './pets/pets.module';
import { VenuesModule } from './venues/venues.module';

@Module({
  imports: [AuthModule, DatabaseModule, PetsModule, VenuesModule],
  controllers: [HealthController],
})
export class AppModule {}
