import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { PetsModule } from './pets/pets.module';

@Module({
  imports: [AuthModule, DatabaseModule, PetsModule],
  controllers: [HealthController],
})
export class AppModule {}
