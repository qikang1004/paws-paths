import { Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { createPool } from './database.pool';

/** DI token：仓储层注入连接池；测试可 override 或直接不依赖（池为 null 时降级 InMemory）。 */
export const PG_POOL = 'PgPool';

/**
 * 收尾连接池。
 *
 * 单独一个 provider 而不是把 pool 包成 class：`PG_POOL` 是个 `Pool | null` 的
 * 工厂值，Nest 不会对工厂返回的对象调生命周期钩子，所以 `app.close()` 时池不会
 * drain —— 进程要等 `idleTimeoutMillis`（30s）才放掉 socket。生产里表现为
 * SIGTERM 后迟迟不退出，测试里表现为 jest 的「did not exit」警告。
 */
@Injectable()
export class DatabasePoolCloser implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabasePoolCloser.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool | null) {}

  async onApplicationShutdown(): Promise<void> {
    if (!this.pool) return;
    try {
      await this.pool.end();
    } catch (err) {
      // 关池失败不该阻断关停流程：进程反正要退了。
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`关闭数据库连接池失败: ${reason}`);
    }
  }
}

@Module({
  providers: [{ provide: PG_POOL, useFactory: createPool }, DatabasePoolCloser],
  exports: [PG_POOL],
})
export class DatabaseModule {}
