import { HistoryService } from '../src/history/history.service';
import {
  InMemoryViewHistoryRepository,
  type ViewHistoryRepository,
} from '../src/history/view-history.repository';
import { InMemoryPetRepository, type PetRepository } from '../src/pets/pet.repository';
import { InMemoryVenueRepository, type VenueRepository } from '../src/venues/venue.repository';

/**
 * 这里只盯两件事：投影不做 N+1，写入永不冒泡。
 * HTTP 行为与投影结果由 history.controller.spec 端到端覆盖。
 */
describe('HistoryService', () => {
  const USER = 'u-svc';
  let history: InMemoryViewHistoryRepository;
  let pets: PetRepository;
  let venues: VenueRepository;
  let service: HistoryService;
  let petsListByIds: jest.SpyInstance;
  let venuesListByIds: jest.SpyInstance;

  beforeEach(() => {
    history = new InMemoryViewHistoryRepository();
    pets = new InMemoryPetRepository();
    venues = new InMemoryVenueRepository();
    petsListByIds = jest.spyOn(pets, 'listByIds');
    venuesListByIds = jest.spyOn(venues, 'listByIds');
    service = new HistoryService(history, pets, venues);
  });

  const list = () => service.list(USER, { page: 1, pageSize: 20 });

  it('混合一页只打两次库 —— 每类一次批量，不按条目 N+1', async () => {
    for (const id of ['p-1', 'p-2', 'p-3']) await history.record(USER, 'pet', id);
    for (const id of ['v-1', 'v-2']) await history.record(USER, 'venue', id);

    const { items } = await list();
    expect(items).toHaveLength(5);
    expect(petsListByIds).toHaveBeenCalledTimes(1);
    expect(venuesListByIds).toHaveBeenCalledTimes(1);
    expect(petsListByIds).toHaveBeenCalledWith(['p-3', 'p-2', 'p-1']);
  });

  it('一页里没有场所就不查场所仓储', async () => {
    await history.record(USER, 'pet', 'p-1');
    await list();
    expect(petsListByIds).toHaveBeenCalledTimes(1);
    expect(venuesListByIds).not.toHaveBeenCalled();
  });

  it('空历史不查任何投影仓储', async () => {
    const { items, hasMore, page } = await list();
    expect({ items, hasMore, page }).toEqual({ items: [], hasMore: false, page: 1 });
    expect(petsListByIds).not.toHaveBeenCalled();
    expect(venuesListByIds).not.toHaveBeenCalled();
  });

  it('recordSafely 未登录直接返回，不打库', () => {
    const spy = jest.spyOn(history, 'record');
    service.recordSafely(null, 'pet', 'p-1');
    expect(spy).not.toHaveBeenCalled();
  });

  it('recordSafely 吞掉仓储异常 —— 详情页不该因为统计表挂掉', async () => {
    const boom: ViewHistoryRepository = {
      record: () => Promise.reject(new Error('库挂了')),
      list: () => Promise.resolve({ entries: [], hasMore: false }),
    };
    const svc = new HistoryService(boom, pets, venues);
    expect(() => svc.recordSafely(USER, 'pet', 'p-1')).not.toThrow();
    // 让 rejection 的 .catch 有机会跑到：没接住的话这里会变成 unhandledRejection
    await new Promise((r) => setImmediate(r));
  });

  it('recordSafely 也吞同步抛错（仓储在 await 之前就炸）', () => {
    const boom: ViewHistoryRepository = {
      record: () => {
        throw new Error('同步炸');
      },
      list: () => Promise.resolve({ entries: [], hasMore: false }),
    };
    const svc = new HistoryService(boom, pets, venues);
    expect(() => svc.recordSafely(USER, 'pet', 'p-1')).not.toThrow();
  });
});
