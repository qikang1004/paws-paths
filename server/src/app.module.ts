import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';

@Module({ imports: [AuthModule, DatabaseModule], controllers: [HealthController] })
export class AppModule {}
