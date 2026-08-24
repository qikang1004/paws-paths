import type Redis from 'ioredis';
import {
  REDIS_OP_TIMEOUT_MS,
  closeRedisClient,
  createRedisClient,
  withTimeout,
} from '../src/common/redis-client';

/** 三处 Redis 客户端共用的连接参数与超时封装。 */
describe('redis-client', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createRedisClient', () => {
    const saved = process.env.REDIS_URL;

    afterEach(() => {
      if (saved === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = saved;
    });

    /** lazyConnect 让这些断言不碰 socket。 */
    function inspect(): Redis {
      const client = createRedisClient();
      client.disconnect(false);
      return client;
    }

    it('收紧了重试上限 —— 默认的 20 次会让宕机 10.7s 才失败', () => {
      expect(inspect().options.maxRetriesPerRequest).toBe(1);
    });

    it('保留离线队列：关掉它会让建连期间（约 1s）的命令全部失败', () => {
      // 对限流器而言等于服务启动第一秒不限流，而那正是暴力破解的窗口
      expect(inspect().options.enableOfflineQueue).not.toBe(false);
    });

    it('懒连接，构造时不开 socket', () => {
      expect(inspect().options.lazyConnect).toBe(true);
    });

    it('建连超时有界', () => {
      expect(inspect().options.connectTimeout).toBe(2000);
    });

    it('retryStrategy 退避有上限，不会无限拉长', () => {
      const strategy = inspect().options.retryStrategy as (t: number) => number;
      expect(strategy(1)).toBe(200);
      expect(strategy(10)).toBe(2000);
      expect(strategy(999)).toBe(5000);
    });

    it('挂了 error 监听，避免 ioredis 打 Unhandled error event', () => {
      const client = createRedisClient();
      expect(client.listenerCount('error')).toBeGreaterThan(0);
      client.disconnect(false);
    });

    it('未设 REDIS_URL 时回落到本机默认', () => {
      delete process.env.REDIS_URL;
      const client = createRedisClient();
      expect(client.options.host).toBe('127.0.0.1');
      expect(client.options.port).toBe(6379);
      client.disconnect(false);
    });
  });

  describe('withTimeout', () => {
    it('任务先完成时透传结果', async () => {
      await expect(withTimeout(Promise.resolve('ok'))).resolves.toBe('ok');
    });

    it('任务先抛错时透传原始错误', async () => {
      await expect(withTimeout(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });

    it('超时后拒绝，错误信息带毫秒数', async () => {
      jest.useFakeTimers();
      const pending = withTimeout(new Promise(() => undefined), 500);
      const assertion = expect(pending).rejects.toThrow('Redis 操作超时 500ms');
      await jest.advanceTimersByTimeAsync(501);
      await assertion;
    });

    it('默认超时用 REDIS_OP_TIMEOUT_MS', async () => {
      jest.useFakeTimers();
      const pending = withTimeout(new Promise(() => undefined));
      const assertion = expect(pending).rejects.toThrow(`超时 ${REDIS_OP_TIMEOUT_MS}ms`);
      await jest.advanceTimersByTimeAsync(REDIS_OP_TIMEOUT_MS + 1);
      await assertion;
    });

    it('任务完成后清掉定时器，不留悬挂句柄', async () => {
      jest.useFakeTimers();
      const before = jest.getTimerCount();
      await withTimeout(Promise.resolve(1));
      expect(jest.getTimerCount()).toBe(before);
    });
  });

  describe('closeRedisClient', () => {
    const fake = (quit: () => Promise<unknown>) =>
      ({ quit: jest.fn(quit), disconnect: jest.fn() }) as unknown as Redis & {
        quit: jest.Mock;
        disconnect: jest.Mock;
      };

    it('undefined 客户端直接返回', async () => {
      await expect(closeRedisClient(undefined)).resolves.toBeUndefined();
    });

    it('正常时先 quit() 优雅告别，再补一次 disconnect 收干 socket', async () => {
      const client = fake(() => Promise.resolve('OK'));
      await closeRedisClient(client);
      expect(client.quit).toHaveBeenCalledTimes(1);
      // quit() 成功也可能留着 socket（实测 jest 报 TCPWRAP open handle）
      expect(client.disconnect).toHaveBeenCalledWith(false);
    });

    it('quit() 挂死时超时强制断开，不卡住进程退出', async () => {
      jest.useFakeTimers();
      const client = fake(() => new Promise(() => undefined));
      const pending = closeRedisClient(client);
      await jest.advanceTimersByTimeAsync(1001);
      await expect(pending).resolves.toBeUndefined();
      // false 同时取消 retryStrategy 排好的重连定时器
      expect(client.disconnect).toHaveBeenCalledWith(false);
    });

    it('quit() 抛错时强制断开', async () => {
      const client = fake(() => Promise.reject(new Error('NOAUTH')));
      await expect(closeRedisClient(client)).resolves.toBeUndefined();
      expect(client.disconnect).toHaveBeenCalledWith(false);
    });
  });
});
