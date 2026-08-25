import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { MeModule } from './me/me.module';
import { PetsModule } from './pets/pets.module';
import { VenuesModule } from './venues/venues.module';

@Module({
  imports: [AuthModule, DatabaseModule, PetsModule, VenuesModule, MeModule],
  controllers: [HealthController],
})
export class AppModule {}
