import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { ERROR_CODES } from '@paws/types';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/response.interceptor';
import {
  InMemoryViewHistoryRepository,
  VIEW_HISTORY_REPOSITORY,
  type ViewHistoryRepository,
} from '../src/history/view-history.repository';
import { MeModule } from '../src/me/me.module';
import { PetsModule } from '../src/pets/pets.module';
import { VenuesModule } from '../src/venues/venues.module';

interface HistoryItem {
  targetType: 'pet' | 'venue';
  targetId: string;
  title: string;
  coverUrl: string | null;
  viewedAt: string;
}

describe('浏览历史（GET /me/history + 详情页异步记录）', () => {
  let app: INestApplication;
  let token: string;

  const USER_ID = 'u-test-history-ctl';

  /**
   * 仓储换成内存实现，且每个用例换新实例。
   *
   * 历史没有删除端点（spec 没要求），一个共享 app 里无法把上一条用例写的行清掉；
   * Postgres 的幂等语义由 view-history-repository.spec 双跑覆盖，这里要测的是
   * HTTP 行为、登录态判定与投影，换成可重置的内存实现最省事也最稳。
   */
  let mem = new InMemoryViewHistoryRepository();
  /** 置 true 后写入失败，用来断言「历史写挂了详情页仍然 200」。 */
  let failMode: 'none' | 'reject' | 'throw' = 'none';
  const repoProxy: ViewHistoryRepository = {
    record: (userId, targetType, targetId) => {
      if (failMode === 'throw') throw new Error('模拟同步抛错');
      if (failMode === 'reject') return Promise.reject(new Error('模拟写入失败'));
      return mem.record(userId, targetType, targetId);
    },
    list: (userId, page) => mem.list(userId, page),
  };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret';
    token = sign({ openid: `openid-${USER_ID}` }, 'test-secret', { subject: USER_ID });
    const moduleRef = await Test.createTestingModule({
      imports: [MeModule, PetsModule, VenuesModule],
    })
      .overrideProvider(VIEW_HISTORY_REPOSITORY)
      .useValue(repoProxy)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mem = new InMemoryViewHistoryRepository();
    failMode = 'none';
  });

  const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const server = () => app.getHttpServer();

  const listHistory = async (query = ''): Promise<HistoryItem[]> => {
    const res = await auth(request(server()).get(`/me/history${query}`)).expect(200);
    expect(res.body.code).toBe(0);
    return res.body.data.items as HistoryItem[];
  };

  /** 异步写入没有回调可等，轮询到出现为止比固定 sleep 稳（也不会拖慢通过的用例）。 */
  const waitForCount = async (n: number): Promise<HistoryItem[]> => {
    const deadline = Date.now() + 2000;
    for (;;) {
      const items = await listHistory();
      if (items.length >= n) return items;
      if (Date.now() > deadline) {
        throw new Error(`浏览历史 2s 内未达到 ${n} 条，实际 ${items.length} 条`);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  /**
   * 要断言「某个请求没写历史」时，紧跟一次一定会写的详情页请求并等它落地：
   * 前一个请求若真写了，也早该在这之前落了。直接查空是假绿 —— 异步写可能还没到。
   */
  const barrier = async (): Promise<HistoryItem[]> => {
    await auth(request(server()).get('/pets/p-8')).expect(200);
    return waitForCount(1);
  };

  describe('GET /me/history', () => {
    it('未登录 → 401', async () => {
      const res = await request(server()).get('/me/history').expect(401);
      expect(res.body.code).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it('没有历史 → 空数组，不是 404', async () => {
      const res = await auth(request(server()).get('/me/history')).expect(200);
      expect(res.body.data).toEqual({ items: [], hasMore: false, page: 1 });
    });

    it('返回混合类型条目，每条带 targetType 与投影后的卡片数据', async () => {
      await mem.record(USER_ID, 'pet', 'p-1');
      await mem.record(USER_ID, 'venue', 'v-1');
      const items = await listHistory();

      expect(items.map((i) => i.targetType)).toEqual(['venue', 'pet']);
      const venue = items[0];
      expect(venue.targetId).toBe('v-1');
      expect(venue.title).toBe('宠福康宠物医院');
      expect(venue.coverUrl).toBeTruthy();
      expect(venue.viewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      const pet = items[1];
      expect(pet.targetId).toBe('p-1');
      expect(pet.title).toBeTruthy();
      expect(pet.coverUrl).toBeTruthy();
    });

    it('按 viewedAt 倒序 —— 最近看的在最前', async () => {
      await mem.record(USER_ID, 'pet', 'p-1');
      await mem.record(USER_ID, 'venue', 'v-2');
      await mem.record(USER_ID, 'pet', 'p-3');
      const items = await listHistory();
      expect(items.map((i) => `${i.targetType}:${i.targetId}`)).toEqual([
        'pet:p-3',
        'venue:v-2',
        'pet:p-1',
      ]);
    });

    it('目标已不存在的条目跳过，不返回半空的行', async () => {
      // 宠物被硬删 / 转私密后历史行还在，投影不到就别渲染。
      await mem.record(USER_ID, 'pet', 'p-已删除');
      await mem.record(USER_ID, 'venue', 'v-不存在');
      await mem.record(USER_ID, 'pet', 'p-2');
      const items = await listHistory();
      expect(items.map((i) => i.targetId)).toEqual(['p-2']);
    });

    it('分页生效：pageSize=2 → hasMore，page 透传', async () => {
      for (const id of ['p-1', 'p-2', 'p-3']) await mem.record(USER_ID, 'pet', id);
      const first = await auth(request(server()).get('/me/history?page=1&pageSize=2')).expect(200);
      expect(first.body.data.items).toHaveLength(2);
      expect(first.body.data.hasMore).toBe(true);

      const second = await auth(request(server()).get('/me/history?page=2&pageSize=2')).expect(200);
      expect(second.body.data.items).toHaveLength(1);
      expect(second.body.data.hasMore).toBe(false);
      expect(second.body.data.page).toBe(2);
    });

    it('page=0 → 422', async () => {
      const res = await auth(request(server()).get('/me/history?page=0')).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('pageSize=100 → 422（上限 20）', async () => {
      const res = await auth(request(server()).get('/me/history?pageSize=100')).expect(422);
      expect(res.body.code).toBe(ERROR_CODES.VALIDATION_FAILED);
    });

    it('不串号：别人的历史不出现在我的列表里', async () => {
      await mem.record('u-1', 'pet', 'p-4');
      expect(await listHistory()).toEqual([]);
    });
  });

  describe('详情页写入时机', () => {
    it('登录态访问 GET /pets/:id 记一条 pet 历史', async () => {
      await auth(request(server()).get('/pets/p-2')).expect(200);
      const items = await waitForCount(1);
      expect(items[0]).toMatchObject({ targetType: 'pet', targetId: 'p-2' });
    });

    it('登录态访问 GET /venues/:poiId 记一条 venue 历史', async () => {
      await auth(request(server()).get('/venues/v-3')).expect(200);
      const items = await waitForCount(1);
      expect(items[0]).toMatchObject({ targetType: 'venue', targetId: 'v-3' });
    });

    it('重复访问同一详情页不堆行，只把它顶到最前', async () => {
      await auth(request(server()).get('/pets/p-2')).expect(200);
      await auth(request(server()).get('/pets/p-3')).expect(200);
      await waitForCount(2);
      await auth(request(server()).get('/pets/p-2')).expect(200);
      // 顶到最前是异步写完之后的事，轮询到顺序翻转为止
      const deadline = Date.now() + 2000;
      for (;;) {
        const items = await listHistory();
        if (items.length === 2 && items[0].targetId === 'p-2') break;
        if (Date.now() > deadline) throw new Error('重复访问未在 2s 内刷新顺序');
        await new Promise((r) => setTimeout(r, 20));
      }
    });

    it('列表页不记历史 —— 只有详情页算「浏览过」', async () => {
      await auth(request(server()).get('/pets')).expect(200);
      await auth(request(server()).get('/venues')).expect(200);
      expect((await barrier()).map((i) => i.targetId)).toEqual(['p-8']);
    });

    it('未登录访问详情页不写历史、也不报错', async () => {
      await request(server()).get('/pets/p-2').expect(200);
      await request(server()).get('/venues/v-3').expect(200);
      // 匿名请求没有 userId，写入应当被直接跳过
      expect((await barrier()).map((i) => i.targetId)).toEqual(['p-8']);
    });

    it('宠物不存在（404）时不写历史', async () => {
      await auth(request(server()).get('/pets/p-does-not-exist')).expect(404);
      expect((await barrier()).map((i) => i.targetId)).toEqual(['p-8']);
    });

    it('场所不存在（404）时不写历史', async () => {
      await auth(request(server()).get('/venues/v-does-not-exist')).expect(404);
      expect((await barrier()).map((i) => i.targetId)).toEqual(['p-8']);
    });

    it('历史写入 reject 时详情页仍 200', async () => {
      failMode = 'reject';
      await auth(request(server()).get('/pets/p-2')).expect(200);
      await auth(request(server()).get('/venues/v-3')).expect(200);
    });

    it('历史写入同步抛错时详情页仍 200', async () => {
      // 仓储实现如果在 await 之前就抛（参数校验之类），fire-and-forget 也得吞住。
      failMode = 'throw';
      await auth(request(server()).get('/pets/p-2')).expect(200);
      await auth(request(server()).get('/venues/v-3')).expect(200);
    });
  });
});
