import Redis from 'ioredis';

/**
 * 三处 Redis 客户端（限流、POI 缓存、access_token 存储）共用的连接参数与超时封装。
 * 抽出来是为了避免各写一份后漂移 —— 快速失败的语义要么处处一致，要么处处不可靠。
 *
 * ## 为什么必须收紧默认值
 *
 * ioredis 默认 maxRetriesPerRequest 是 20。实测（远端 Redis vs 本地不可达端口）：
 *
 *   默认配置    健康 554ms / 宕机 10719ms
 *   本配置      健康 554ms / 宕机 212~2000ms
 *
 * 10.7 秒的失败对调用方等于挂死：POI 缓存的「降级不阻断主链路」要等 10 秒才降级，
 * access_token 缓存故障会把每个微信接口调用拖死 10 秒。
 *
 * ## 为什么保留 enableOfflineQueue
 *
 * 关掉它虽然让宕机期命令 0ms 失败，但 lazyConnect 下建连要约 1s，期间所有命令
 * 都会失败。对限流器来说等于服务启动第一秒不限流 —— 那正是暴力破解最可能撞上的
 * 窗口。所以保留离线队列，靠 maxRetriesPerRequest + 硬超时限制放大。
 */
const REDIS_OPTIONS = {
  lazyConnect: true,
  connectTimeout: 2000,
  maxRetriesPerRequest: 1,
  retryStrategy: (times: number): number => Math.min(times * 200, 5000),
} as const;

/** 单次 Redis 操作的硬上限，兜住上面参数没覆盖到的挂死情形。 */
export const REDIS_OP_TIMEOUT_MS = 2000;

/** 关闭时等 quit() 应答的上限。 */
const QUIT_TIMEOUT_MS = 1000;

/**
 * 建懒连接客户端。error 事件挂个空监听：ioredis 在无人监听时会打印
 * "Unhandled error event"，而命令级错误由各调用点自己 catch。
 */
export function createRedisClient(): Redis {
  const client = new Redis(
    process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
    REDIS_OPTIONS,
  );
  client.on('error', () => undefined);
  return client;
}

/** 给 Promise 套硬超时。清理定时器，避免留悬挂句柄。 */
export function withTimeout<T>(task: Promise<T>, ms = REDIS_OP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    task,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Redis 操作超时 ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 优雅关闭。quit() 要等服务端应答，Redis 不可达时不会解析，会把进程关闭卡住；
 * 超时后 disconnect(false) 兜底 —— false 同时取消 retryStrategy 排好的重连定时器。
 */
export async function closeRedisClient(client: Redis | undefined): Promise<void> {
  if (!client) return;
  try {
    await withTimeout(client.quit(), QUIT_TIMEOUT_MS);
  } catch {
    // 忽略：下面的 disconnect 兜底
  } finally {
    // quit() 成功也补一次 disconnect —— 实测它偶尔留着 socket（jest 报 TCPWRAP
    // open handle）。已断开的客户端上重复调用是安全的空操作。
    client.disconnect(false);
  }
}
