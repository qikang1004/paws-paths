import { wxAdapter, type WxAdapter } from '../api/wx-promise';

export interface Coords {
  latitude: number;
  longitude: number;
}

export type LocationState = { mode: 'precise'; coords: Coords } | { mode: 'city' };

/** 位置单点持有：并发调用共享同一次授权，拒绝后记住降级结果，不反复弹框。 */
export class LocationStore {
  private current: LocationState | null = null;
  private inflight: Promise<LocationState> | null = null;
  private generation = 0;

  constructor(private readonly wx: WxAdapter) {}

  get state(): LocationState | null {
    return this.current;
  }

  /** 用户在系统设置里重新打开定位后调用，清掉降级结果重新申请。 */
  reset(): void {
    this.generation += 1;
    this.current = null;
    this.inflight = null;
  }

  ensure(): Promise<LocationState> {
    if (this.current) return Promise.resolve(this.current);
    if (!this.inflight) {
      const generation = this.generation;
      const task = this.resolveState(generation);
      this.inflight = task;
      const release = (): void => {
        if (this.inflight === task) this.inflight = null;
      };
      task.then(release, release);
    }
    return this.inflight;
  }

  private async resolveState(generation: number): Promise<LocationState> {
    let state: LocationState;
    try {
      const coords = await this.wx.getLocation();
      state = { mode: 'precise', coords };
    } catch {
      // 拒绝授权不是错误：spec §6 要求降级为按城市浏览，距离字段隐藏。
      state = { mode: 'city' };
    }
    if (this.generation === generation) this.current = state;
    return state;
  }
}

/** 全局单例，页面一律用这个，不要各自 new。 */
export const locationStore = new LocationStore(wxAdapter);
