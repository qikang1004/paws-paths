import { LocationStore } from '../store/location';
import { FakeWx } from './fake-wx';

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

  it('reset 后允许重新申请授权', async () => {
    wx.locationOutcome = new Error('auth deny');
    await store.ensure();
    wx.locationOutcome = { latitude: 22.54, longitude: 114.06 };
    store.reset();
    expect(await store.ensure()).toEqual({
      mode: 'precise',
      coords: { latitude: 22.54, longitude: 114.06 },
    });
    expect(wx.getLocationCalls).toBe(2);
  });
});
