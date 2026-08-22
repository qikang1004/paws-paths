import { ApiError } from '../api/errors';
import type { WxAdapter } from '../api/wx-promise';
import { ERROR_CODES, messageForCode } from '../shared/types/index';

export const TOKEN_STORAGE_KEY = 'paws:token';

interface LoginData {
  token: string;
  userId: string;
  isNewUser: boolean;
}

interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

/** 登录态单点持有：飞行中的登录请求被复用，避免并发拉起多次 wx.login。 */
export class SessionStore {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly wx: WxAdapter,
    private readonly baseUrl: string,
  ) {}

  get token(): string | null {
    return this.wx.getStorage(TOKEN_STORAGE_KEY);
  }

  clear(): void {
    this.wx.removeStorage(TOKEN_STORAGE_KEY);
  }

  refresh(): Promise<string> {
    if (!this.inflight) {
      const task = this.doRefresh();
      this.inflight = task;
      const release = (): void => {
        if (this.inflight === task) this.inflight = null;
      };
      task.then(release, release);
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<string> {
    const { code } = await this.wx.login();
    const response = await this.wx.request<Envelope<LoginData>>({
      url: `${this.baseUrl}/auth/wx-login`,
      method: 'POST',
      data: { code },
    });
    const body = response.data;

    if (body.code !== ERROR_CODES.OK || !body.data) {
      throw new ApiError(body.code, messageForCode(body.code, body.message));
    }

    this.wx.setStorage(TOKEN_STORAGE_KEY, body.data.token);
    return body.data.token;
  }
}
