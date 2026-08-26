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

/**
 * `wx.uploadFile` 的入参。它和 `wx.request` 不是一套通道：走的是 multipart，
 * `formData` 的字段**一律是字符串**（服务端的 `parseDimension` 因此只收字符串）。
 *
 * 刻意不带 `content-type`：boundary 由 wx 自己填，手写那行 header 会让服务端
 * 解不出分隔符，表现成「文件字段缺失」。
 */
export interface WxUploadOptions {
  url: string;
  filePath: string;
  name: string;
  formData?: Record<string, string>;
  header?: Record<string, string>;
}

/** 上传的响应体是**字符串** —— multipart 通道不会帮你 JSON.parse。 */
export interface WxUploadResult {
  statusCode: number;
  data: string;
}

/**
 * `wx.chooseMedia` 选出来的一张图。**宽高必须从这里拿**：
 * `post_images.width/height` 是非可选列（Global Constraint 21），
 * 服务端缺宽高直接 422，而客户端估不出真实尺寸。
 */
export interface WxMediaFile {
  tempFilePath: string;
  width: number;
  height: number;
  size: number;
}

/** 收口所有用到的 wx 接口，页面与 store 只依赖这个接口。 */
export interface WxAdapter {
  login(): Promise<{ code: string }>;
  request<T>(opts: WxRequestOptions): Promise<WxRequestResult<T>>;
  uploadFile(opts: WxUploadOptions): Promise<WxUploadResult>;
  getStorage(key: string): string | null;
  setStorage(key: string, value: string): void;
  removeStorage(key: string): void;
  getLocation(): Promise<{ latitude: number; longitude: number }>;
  chooseMedia(count: number): Promise<WxMediaFile[]>;
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

  uploadFile: (opts: WxUploadOptions) =>
    new Promise<WxUploadResult>((resolve, reject) => {
      wx.uploadFile({
        url: opts.url,
        filePath: opts.filePath,
        name: opts.name,
        formData: opts.formData,
        header: opts.header,
        // 这里的 data 是原始字符串，解信封的活在 ApiClient.upload 里做。
        success: (result) => resolve({ statusCode: result.statusCode, data: result.data }),
        fail: reject,
      });
    }),

  getStorage: (key) => (wx.getStorageSync(key) as string) || null,
  setStorage: (key, value) => wx.setStorageSync(key, value),
  removeStorage: (key) => wx.removeStorageSync(key),

  getLocation: () =>
    new Promise((resolve, reject) => {
      // gcj02 与腾讯地图坐标系一致；必须先在 app.json 声明 requiredPrivateInfos，否则直接 fail。
      wx.getLocation({
        type: 'gcj02',
        success: (res) => resolve({ latitude: res.latitude, longitude: res.longitude }),
        fail: reject,
      });
    }),

  chooseMedia: (count: number) =>
    new Promise((resolve, reject) => {
      wx.chooseMedia({
        count,
        mediaType: ['image'],
        // 相册与相机都给：发布动态两条路都要走得通。
        sourceType: ['album', 'camera'],
        // 压缩图仍带真实宽高（wx 返回的是压缩后的尺寸），瀑布流要的就是这个比例。
        sizeType: ['compressed'],
        success: (res) =>
          resolve(
            res.tempFiles.map((file) => ({
              tempFilePath: file.tempFilePath,
              width: file.width ?? 0,
              height: file.height ?? 0,
              size: file.size,
            })),
          ),
        // 用户点「取消」也走 fail。调用方（api/media.ts）负责把它归成「没选图」。
        fail: reject,
      });
    }),
};
