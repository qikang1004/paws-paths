export interface WxRequestOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: unknown;
  header?: Record<string, string>;
}

export interface WxRequestResult<T> {
  statusCode: number;
  data: T;
}

/** 收口所有用到的 wx 接口，页面与 store 只依赖这个接口。 */
export interface WxAdapter {
  login(): Promise<{ code: string }>;
  request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>>;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
  removeStorage(key: string): void;
}

export const wxAdapter: WxAdapter = {
  login: () =>
    new Promise((resolve, reject) => {
      wx.login({ success: (result) => resolve({ code: result.code }), fail: reject });
    }),

  request: <T>(opts: WxRequestOptions) =>
    new Promise<WxRequestResult<T>>((resolve, reject) => {
      wx.request({
        url: opts.url,
        method: opts.method,
        data: opts.data as WechatMiniprogram.RequestOption['data'],
        header: opts.header,
        success: (result) => resolve({ statusCode: result.statusCode, data: result.data as T }),
        fail: reject,
      });
    }),

  getStorage: (key) => (wx.getStorageSync(key) as string) || null,
  setStorage: (key, value) => wx.setStorageSync(key, value),
  removeStorage: (key) => wx.removeStorageSync(key),
};
