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

  constructor(private readonly wx: WxAdapter) {}

  get state(): LocationState | null {
    return this.current;
  }

  /** 用户在系统设置里重新打开定位后调用，清掉降级结果重新申请。 */
  reset(): void {
    this.current = null;
  }

  ensure(): Promise<LocationState> {
    if (this.current) return Promise.resolve(this.current);
    if (!this.inflight) {
      const task = this.resolveState();
      this.inflight = task;
      const release = (): void => {
        if (this.inflight === task) this.inflight = null;
      };
      task.then(release, release);
    }
    return this.inflight;
  }

  private async resolveState(): Promise<LocationState> {
    try {
      const coords = await this.wx.getLocation();
      this.current = { mode: 'precise', coords };
    } catch {
      // 拒绝授权不是错误：spec §6 要求降级为按城市浏览，距离字段隐藏。
      this.current = { mode: 'city' };
    }
    return this.current;
  }
}

/** 全局单例，页面一律用这个，不要各自 new。 */
export const locationStore = new LocationStore(wxAdapter);
