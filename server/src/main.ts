import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseInterceptor } from './common/response.interceptor';
import { PG_POOL } from './database/database.module';
import { runMigrations, shouldSeed } from './database/migrations';

/**
 * 设了 DATABASE_URL 就在启动时建表——否则「起库 + 设 URL」之后首个请求必然
 * relation does not exist。schema.sql 幂等，重复启动无副作用。
 * 演示数据另需 SEED_DEMO_DATA=1，生产不会被 8 只测试宠物污染。
 */
async function migrate(pool: Pool | null, logger: Logger): Promise<void> {
  if (!pool) {
    logger.log('未设 DATABASE_URL，以 InMemory 模式启动');
    return;
  }
  const seed = shouldSeed(process.env.SEED_DEMO_DATA);
  await runMigrations(pool, { seed });
  logger.log(seed ? '迁移完成（含演示数据）' : '迁移完成（仅建表）');
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // 迁移失败就不要开始收流量：带着空库对外服务只会把错误推给用户。
  await migrate(app.get<Pool | null>(PG_POOL), new Logger('Migrations'));

  // 微信云托管从 PORT 注入端口，本地缺省 3000。
  await app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0');
}

void bootstrap();
