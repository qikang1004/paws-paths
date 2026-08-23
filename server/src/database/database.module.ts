import { Module } from '@nestjs/common';
import { createPool } from './database.pool';

/** DI token：仓储层注入连接池；测试可 override 或直接不依赖（池为 null 时降级 InMemory）。 */
export const PG_POOL = 'PgPool';

@Module({
  providers: [{ provide: PG_POOL, useFactory: createPool }],
  exports: [PG_POOL],
})
export class DatabaseModule {}
