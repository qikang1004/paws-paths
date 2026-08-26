import { MAX_IMAGE_BYTES, pickAndUploadImages } from '../api/media';
import { ApiClient } from '../api/request';
import type { WxMediaFile } from '../api/wx-promise';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, okText } from './fake-wx';

const BASE = 'https://api.example.com';

const file = (over: Partial<WxMediaFile> = {}): WxMediaFile => ({
  tempFilePath: 'wxfile://tmp/1.jpg',
  width: 1200,
  height: 900,
  size: 200 * 1024,
  ...over,
});

/**
 * 选图 + 上传。这一段的存在理由是 Global Constraint 21：
 * `post_images.width/height` 是非可选列，宽高必须从 `wx.chooseMedia` 的返回里
 * 原样带到上传接口，不能由页面估。
 */
describe('pickAndUploadImages', () => {
  let wx: FakeWx;
  let client: ApiClient;

  const uploadResult = (over: Record<string, unknown> = {}) => ({
    key: 'u-1/a.jpg',
    url: '/uploads/u-1/a.jpg',
    width: 1200,
    height: 900,
    auditStatus: 'pending',
    ...over,
  });

  beforeEach(() => {
    wx = new FakeWx();
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  it('把 chooseMedia 给的真实宽高原样发给上传接口', async () => {
    wx.mediaOutcome = [file({ width: 1080, height: 1920 })];
    wx.queueUpload(() => okText(uploadResult({ width: 1080, height: 1920 })));

    const res = await pickAndUploadImages(9, { wx, client });

    expect(wx.chooseMediaCalls).toEqual([9]);
    // multipart 的字段是字符串，且必须是 chooseMedia 的原值 —— 估算值会让瀑布流跳版。
    expect(wx.uploaded[0].formData).toEqual({ width: '1080', height: '1920' });
    expect(wx.uploaded[0].filePath).toBe('wxfile://tmp/1.jpg');
    expect(res.images).toEqual([
      { url: '/uploads/u-1/a.jpg', width: 1080, height: 1920, auditStatus: 'pending' },
    ]);
    expect(res.skipped).toBe(0);
    expect(res.canceled).toBe(false);
  });

  it('宽高取的是服务端回执而不是本地值（服务端会按真实解码尺寸纠正）', async () => {
    wx.mediaOutcome = [file({ width: 999, height: 111 })];
    wx.queueUpload(() => okText(uploadResult({ width: 400, height: 300 })));
    const res = await pickAndUploadImages(1, { wx, client });
    expect(res.images[0]).toMatchObject({ width: 400, height: 300 });
  });

  it('多张图顺序上传，返回顺序与选图顺序一致', async () => {
    wx.mediaOutcome = [
      file({ tempFilePath: 'a.jpg' }),
      file({ tempFilePath: 'b.jpg' }),
      file({ tempFilePath: 'c.jpg' }),
    ];
    wx.queueUpload(
      () => okText(uploadResult({ url: '/uploads/a.jpg' })),
      () => okText(uploadResult({ url: '/uploads/b.jpg' })),
      () => okText(uploadResult({ url: '/uploads/c.jpg' })),
    );
    const res = await pickAndUploadImages(3, { wx, client });
    expect(wx.uploaded.map((u) => u.filePath)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(res.images.map((i) => i.url)).toEqual([
      '/uploads/a.jpg',
      '/uploads/b.jpg',
      '/uploads/c.jpg',
    ]);
  });

  it('用户取消（chooseMedia fail）→ canceled，不抛错、不上传', async () => {
    // wx 的取消与真实失败都走 fail 回调，没有可区分的错误码。
    wx.mediaOutcome = new Error('cancel');
    const res = await pickAndUploadImages(9, { wx, client });
    expect(res).toEqual({ images: [], skipped: 0, canceled: true });
    expect(wx.uploaded).toHaveLength(0);
  });

  it('宽或高是 0 的图直接跳过，不编一个尺寸糊过服务端校验', async () => {
    wx.mediaOutcome = [file({ width: 0 }), file({ height: 0 }), file()];
    wx.queueUpload(() => okText(uploadResult()));
    const res = await pickAndUploadImages(3, { wx, client });
    expect(wx.uploaded).toHaveLength(1);
    expect(res.images).toHaveLength(1);
    expect(res.skipped).toBe(2);
    // 全被挡下也不是「取消」：页面要提示这几张没传上去。
    expect(res.canceled).toBe(false);
  });

  it('超过 5MB 的图本地就挡下，省一次注定 422 的上传', async () => {
    wx.mediaOutcome = [file({ size: MAX_IMAGE_BYTES + 1 }), file({ size: MAX_IMAGE_BYTES })];
    wx.queueUpload(() => okText(uploadResult()));
    const res = await pickAndUploadImages(2, { wx, client });
    // 正好 5MB 是允许的边界，与服务端的 `data.length > MAX_UPLOAD_BYTES` 一致。
    expect(wx.uploaded).toHaveLength(1);
    expect(res.skipped).toBe(1);
  });

  it('某一张上传失败时把错误抛给页面，已传成功的那几张不吞掉重试职责', async () => {
    wx.mediaOutcome = [file({ tempFilePath: 'a.jpg' }), file({ tempFilePath: 'b.jpg' })];
    wx.queueUpload(
      () => okText(uploadResult()),
      () => ({ statusCode: 500, data: JSON.stringify({ code: 50000, message: '炸了', data: null }) }),
    );
    await expect(pickAndUploadImages(2, { wx, client })).rejects.toBeTruthy();
    expect(wx.uploaded).toHaveLength(2);
  });

  it('一张都没选（tempFiles 空）→ 空结果，不算取消', async () => {
    wx.mediaOutcome = [];
    const res = await pickAndUploadImages(9, { wx, client });
    expect(res).toEqual({ images: [], skipped: 0, canceled: false });
  });
});
