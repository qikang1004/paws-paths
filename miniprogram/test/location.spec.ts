import { LocationStore, type Coords } from '../store/location';
import { FakeWx } from './fake-wx';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

class DeferredWx extends FakeWx {
  readonly locationRequests: Array<Deferred<Coords>> = [];

  override getLocation(): Promise<Coords> {
    this.getLocationCalls += 1;
    const request = deferred<Coords>();
    this.locationRequests.push(request);
    return request.promise;
  }
}

describe('LocationStore', () => {
  let wx: FakeWx;
  let store: LocationStore;

  beforeEach(() => {
    wx = new FakeWx();
    store = new LocationStore(wx);
  });

  it('授权成功时进入精确模式并缓存坐标', async () => {
    expect(await store.ensure()).toEqual({
      mode: 'precise',
      coords: { latitude: 31.23, longitude: 121.47 },
    });
    expect(store.state).toEqual({ mode: 'precise', coords: { latitude: 31.23, longitude: 121.47 } });
  });

  it('并发 3 次 ensure 只弹一次授权', async () => {
    await Promise.all([store.ensure(), store.ensure(), store.ensure()]);
    expect(wx.getLocationCalls).toBe(1);
  });

  it('已有结果后再 ensure 不再调用 wx.getLocation', async () => {
    await store.ensure();
    await store.ensure();
    expect(wx.getLocationCalls).toBe(1);
  });

  it('拒绝授权时降级为城市模式且不抛错', async () => {
    wx.locationOutcome = new Error('auth deny');
    expect(await store.ensure()).toEqual({ mode: 'city' });
  });

  it('拒绝过一次后不再反复弹框', async () => {
    wx.locationOutcome = new Error('auth deny');
    await store.ensure();
    await store.ensure();
    expect(wx.getLocationCalls).toBe(1);
  });

  it('reset 后旧请求完成不能覆盖新的定位结果', async () => {
    const deferredWx = new DeferredWx();
    const deferredStore = new LocationStore(deferredWx);

    const requestA = deferredStore.ensure();
    expect(deferredWx.getLocationCalls).toBe(1);

    deferredStore.reset();
    const requestB = deferredStore.ensure();
    expect(deferredWx.getLocationCalls).toBe(2);

    const coordsB = { latitude: 22.54, longitude: 114.06 };
    deferredWx.locationRequests[1].resolve(coordsB);
    await expect(requestB).resolves.toEqual({ mode: 'precise', coords: coordsB });
    expect(deferredStore.state).toEqual({ mode: 'precise', coords: coordsB });

    const coordsA = { latitude: 31.23, longitude: 121.47 };
    deferredWx.locationRequests[0].resolve(coordsA);
    await expect(requestA).resolves.toEqual({ mode: 'precise', coords: coordsA });
    expect(deferredStore.state).toEqual({ mode: 'precise', coords: coordsB });
  });
});
