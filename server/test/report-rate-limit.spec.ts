import {
  Controller,
  HttpCode,
  HttpStatus,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AuthGuard } from '../src/auth/auth.guard';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ApiException } from '../src/common/api.exception';
import { ReportRateLimitGuard } from '../src/common/rate-limit/report-rate-limit.guard';
import {
  REPORT_RATE_LIMIT,
  RateLimiterService,
} from '../src/common/rate-limit/rate-limit.service';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../src/common/rate-limit/rate-limit.store';
import { ResponseInterceptor } from '../src/common/response.interceptor';

/**
 * 举报限流（阶段 3 收尾补入）。
 *
 * 为什么必须有：`POST /reports` 每成功一次，那条内容就**立刻对所有人隐藏**
 * （直到运营复核）。没有限流的话，一个账号可以把整页内容逐条举报，
 * 等于拿到了一个批量下架按钮。这是本阶段最直接的滥用面。
 *
 * 与登录限流的两处关键差别，下面各有断言钉着：
 *   · **按 userId 键控，不是 IP** —— 举报要求登录，而滥用的单位是账号：
 *     同一 IP 后面可能是整个校园网，按 IP 限会连坐无辜的人；
 *     而换 IP 对一个账号来说太容易了，按 IP 限也拦不住真正想刷的人。
 *   · **窗口长得多**（默认 1 小时 10 次，不是 1 分钟 30 次）：正常人一小时
 *     举报不了 10 条内容，而登录重试是分钟级的行为。
 */

/** 带窗口语义的内存实现（同 rate-limit.spec.ts 里那份，两处都不碰 Redis）。 */
class InMemoryRateLimitStore implements RateLimitStore {
  private counts = new Map<string, { count: number; expiresAt: number }>();
  now = Date.now;

  async increment(key: string, windowSeconds: number): Promise<number> {
    const t = this.now();
    const entry = this.counts.get(key);
    if (!entry || entry.expiresAt <= t) {
      this.counts.set(key, { count: 1, expiresAt: t + windowSeconds * 1000 });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  /** 只为断言用：看某个 key 现在计到几。 */
  peek(key: string): number {
    return this.counts.get(key)?.count ?? 0;
  }
}

/** 只为本套件存在的探针 —— 守卫的行为与「那个端点做什么」无关。 */
@Controller('probe')
class ProbeController {
  /**
   * 守卫数组顺序执行：AuthGuard 先挂好 req.userId，限流守卫才有键可用。
   *
   * `@HttpCode(200)` 与真的 `POST /reports` 一致（举报幂等，201 会在
   * 「什么都没新建」那一路上说谎）—— 探针跟着对齐，断言里才好写 200。
   */
  @Post('report')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, ReportRateLimitGuard)
  report(): { ok: true } {
    return { ok: true };
  }
}

describe('举报限流（按 userId，不是 IP）', () => {
  let app: INestApplication;
  let store: InMemoryRateLimitStore;

  const tokenFor = (sub: string) =>
    sign({ openid: `openid-${sub}` }, 'test-secret', { subject: sub });

  const post = (sub?: string) => {
    const req = request(app.getHttpServer()).post('/probe/report');
    return sub ? req.set('Authorization', `Bearer ${tokenFor(sub)}`) : req;
  };

  beforeEach(async () => {
    process.env.JWT_SECRET = 'test-secret';
    store = new InMemoryRateLimitStore();
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
      providers: [
        AuthGuard,
        ReportRateLimitGuard,
        RateLimiterService,
        { provide: RATE_LIMIT_STORE, useValue: store },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('默认上限是「一小时 10 次」—— 不是登录那套「一分钟 30 次」', () => {
    // 数值本身也是契约：改它要连带改 RELEASE_CHECKLIST 与 notes 里的说明。
    expect(REPORT_RATE_LIMIT).toEqual({ windowSeconds: 3600, maxAttempts: 10 });
  });

  it('窗口内前 10 次放行，第 11 次 429 + RATE_LIMITED', async () => {
    for (let i = 0; i < 10; i += 1) {
      await post('u-1').expect(200);
    }
    const over = await post('u-1').expect(429);
    expect(over.body.code).toBe(ERROR_CODES.RATE_LIMITED);
  });

  it('按 userId 键控：另一个账号不受影响（同一进程、同一 IP）', async () => {
    for (let i = 0; i < 11; i += 1) {
      await post('u-1');
    }
    // 上面那个账号已经超限了，这个账号照常。
    await post('u-2').expect(200);
    // 键里带的是 userId 而不是 ip —— 拿键名本身断言，免得「凑巧独立」也算通过。
    expect(store.peek('report:u-1')).toBeGreaterThan(10);
    expect(store.peek('report:u-2')).toBe(1);
  });

  it('键名不含 IP —— 同一 IP 的不同账号不连坐', async () => {
    await post('u-3').expect(200);
    // supertest 打的是 127.0.0.1；键里若混进 ip，这条会红。
    expect(store.peek('report:u-3')).toBe(1);
    expect(store.peek('report:127.0.0.1')).toBe(0);
  });

  it('窗口过期后重新放行', async () => {
    const base = Date.now();
    store.now = () => base;
    for (let i = 0; i < 11; i += 1) {
      await post('u-4');
    }
    await post('u-4').expect(429);
    // 跨过一小时。
    store.now = () => base + 3600_001;
    await post('u-4').expect(200);
  });

  it('未登录 → 401，且**不计数**（限流不该被匿名请求撑满）', async () => {
    await post().expect(401);
    // AuthGuard 先抛，限流守卫压根没跑 —— 否则匿名请求能把某个键刷爆，
    // 而那个键还得先有 userId 才拼得出来。
    expect(store.peek('report:unknown')).toBe(0);
    expect(store.peek('report:undefined')).toBe(0);
  });

  it('Redis 不可用时降级放行（fail-open，与登录限流同一取舍）', async () => {
    // 生产实现里 RedisRateLimitStore.increment 捕获异常后返回 0，
    // 限流器视为未超限。这里直接注入一个恒抛的 store 验同一条路径。
    const broken: RateLimitStore = {
      increment: async () => {
        throw new Error('Redis 挂了');
      },
    };
    const limiter = new RateLimiterService(broken);
    // 服务层不吞异常 —— 降级发生在 store 里（那里有告警日志）。
    // 这条断言钉住「异常不会被限流器悄悄变成 429」：真出故障时用户看到的
    // 该是 500 或降级放行，而不是一个误导人的「操作太频繁」。
    await expect(limiter.check('report:u-5', REPORT_RATE_LIMIT)).rejects.toThrow('Redis 挂了');
    await expect(limiter.check('report:u-5', REPORT_RATE_LIMIT)).rejects.not.toBeInstanceOf(
      ApiException,
    );
  });
});

describe('RateLimiterService 的按次覆盖', () => {
  let store: InMemoryRateLimitStore;
  let limiter: RateLimiterService;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
    limiter = new RateLimiterService(store);
  });

  it('check 的第二个参数按次覆盖窗口与上限，不影响默认值', async () => {
    // 举报与登录共用一个 RateLimiterService 单例（它的默认值是登录那套），
    // 所以举报必须能在调用处带自己的数值 —— 否则就得再造一个 provider。
    await limiter.check('a', { windowSeconds: 3600, maxAttempts: 2 });
    await limiter.check('a', { windowSeconds: 3600, maxAttempts: 2 });
    await expect(limiter.check('a', { windowSeconds: 3600, maxAttempts: 2 })).rejects.toMatchObject(
      { code: ERROR_CODES.RATE_LIMITED, status: HttpStatus.TOO_MANY_REQUESTS },
    );

    // 默认那套（60s / 30 次）没被改动。
    for (let i = 0; i < 30; i += 1) {
      await limiter.check('b');
    }
    await expect(limiter.check('b')).rejects.toMatchObject({ code: ERROR_CODES.RATE_LIMITED });
  });
});
