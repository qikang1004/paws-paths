import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseModule, DatabasePoolCloser, PG_POOL } from '../src/database/database.module';

describe('优雅关停', () => {
  describe('DatabasePoolCloser', () => {
    it('关停时 drain 连接池', async () => {
      const end = jest.fn().mockResolvedValue(undefined);
      const moduleRef = await Test.createTestingModule({
        providers: [{ provide: PG_POOL, useValue: { end } }, DatabasePoolCloser],
      }).compile();
      const app = moduleRef.createNestApplication();
      await app.init();
      await app.close();
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('池为 null（InMemory 模式）时什么都不做，不抛', async () => {
      const closer = new DatabasePoolCloser(null);
      await expect(closer.onApplicationShutdown()).resolves.toBeUndefined();
    });

    it('关池失败不冒泡 —— 进程反正要退了，别把关停流程搞崩', async () => {
      const pool = { end: jest.fn().mockRejectedValue(new Error('boom')) } as unknown as Pool;
      const closer = new DatabasePoolCloser(pool);
      await expect(closer.onApplicationShutdown()).resolves.toBeUndefined();
    });

    it('挂在 DatabaseModule 上 —— 光有类没注册等于没修', async () => {
      const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();
      expect(moduleRef.get(DatabasePoolCloser, { strict: false })).toBeInstanceOf(
        DatabasePoolCloser,
      );
    });
  });

  it('main.ts 开了 enableShutdownHooks —— 不开则所有生命周期钩子在 SIGTERM 时都不跑', () => {
    // 这条是回归守卫而不是行为测试：钩子没开的话，Redis 客户端的 onModuleDestroy
    // 和上面的连接池收尾全都是死代码，而单测里 app.close() 又照样能跑通，
    // 于是这个问题只在生产的滚动发布时暴露。
    const main = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8');
    expect(main).toContain('app.enableShutdownHooks()');
  });
});
