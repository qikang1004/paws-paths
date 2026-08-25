import { followPet, fetchFollowing, unfollowPet } from '../api/follows';
import { fetchFavorites, fetchHistory, fetchProfile, updateProfile } from '../api/me';
import {
  addPetPhoto,
  createPet,
  deletePet,
  favoritePet,
  removePetPhoto,
  unfavoritePet,
  updatePet,
} from '../api/pets';
import { fetchPostDetail, fetchPosts, publishPost } from '../api/posts';
import { ApiError } from '../api/errors';
import { ApiClient } from '../api/request';
import { uploadImage } from '../api/uploads';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, ok, okText } from './fake-wx';

const BASE = 'https://api.example.com';

/**
 * 阶段 2 的 api 包装：关注、动态、个人中心、宠物写端点、图片上传。
 *
 * 这一层只做两件事 —— 拼 URL/参数、把信封解开。业务判断（角标怎么显示、
 * 图片地址怎么补全）在 `utils/post-view.ts`，页面一行 wx.request 都不写
 * （Global Constraint 3，由 wx-guard 兜住）。
 */
describe('阶段 2 api 包装', () => {
  let wx: FakeWx;
  let client: ApiClient;

  beforeEach(() => {
    wx = new FakeWx();
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  describe('关注', () => {
    it('followPet 发 POST /pets/:id/follow', async () => {
      wx.queue(() => ok({ isFollowing: true }));
      const res = await followPet('p-1', client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1/follow`);
      expect(res.isFollowing).toBe(true);
    });

    it('unfollowPet 发 DELETE /pets/:id/follow', async () => {
      wx.queue(() => ok({ isFollowing: false }));
      const res = await unfollowPet('p-1', client);
      expect(wx.sent[0].method).toBe('DELETE');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1/follow`);
      expect(res.isFollowing).toBe(false);
    });

    it('fetchFollowing 发 GET /me/following，分页进 data', async () => {
      wx.queue(() => ok({ items: [], hasMore: false, page: 2 }));
      await fetchFollowing({ page: 2, pageSize: 20 }, client);
      expect(wx.sent[0].method).toBe('GET');
      expect(wx.sent[0].url).toBe(`${BASE}/me/following`);
      expect(wx.sent[0].data).toEqual({ page: 2, pageSize: 20 });
    });
  });

  describe('动态', () => {
    it('publishPost 发 POST /posts，body 带 petId / content / images', async () => {
      wx.queue(() => ok({ id: 'po-9', auditStatus: 'pending' }));
      const images = [{ url: '/uploads/u-1/a.jpg', width: 400, height: 300 }];
      await publishPost({ petId: 'p-1', content: '出门遛弯', images }, client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/posts`);
      expect(wx.sent[0].data).toEqual({ petId: 'p-1', content: '出门遛弯', images });
    });

    it('publishPost 不传图片时发空数组，不发 undefined', async () => {
      wx.queue(() => ok({ id: 'po-9' }));
      await publishPost({ petId: 'p-1', content: '只有文字' }, client);
      expect(wx.sent[0].data).toEqual({ petId: 'p-1', content: '只有文字', images: [] });
    });

    it('fetchPosts 发 GET /posts，petId 与分页都进 data', async () => {
      wx.queue(() => ok({ items: [], hasMore: false, page: 1 }));
      await fetchPosts({ petId: 'p-1', page: 1, pageSize: 10 }, client);
      expect(wx.sent[0].url).toBe(`${BASE}/posts`);
      expect(wx.sent[0].data).toEqual({ petId: 'p-1', page: 1, pageSize: 10 });
    });

    it('fetchPostDetail 把 id 拼进 url', async () => {
      wx.queue(() => ok({ id: 'po-1' }));
      await fetchPostDetail('po-1', client);
      expect(wx.sent[0].url).toBe(`${BASE}/posts/po-1`);
    });
  });

  describe('个人中心', () => {
    it('fetchProfile 发 GET /me', async () => {
      wx.queue(() => ok({ nickname: '微信用户', petCount: 0 }));
      const res = await fetchProfile(client);
      expect(wx.sent[0].url).toBe(`${BASE}/me`);
      expect(res.nickname).toBe('微信用户');
    });

    it('updateProfile 发 PUT /me，只带调用方真给了的字段', async () => {
      // 不是 PATCH：`wx.request` 的 method 白名单里没有 PATCH，小程序端发不出去。
      // 服务端 /me 同时挂了 PATCH 与 PUT，共用一份局部更新实现。
      wx.queue(() => ok({ nickname: '大黄的主人' }));
      await updateProfile({ nickname: '大黄的主人' }, client);
      expect(wx.sent[0].method).toBe('PUT');
      expect(wx.sent[0].url).toBe(`${BASE}/me`);
      expect(wx.sent[0].data).toEqual({ nickname: '大黄的主人' });
    });

    it('updateProfile 的 avatarUrl: null 必须发出去 —— 那是「清空头像」', async () => {
      // 服务端按 `'avatarUrl' in body` 判断，丢了这个 key 就变成「不动头像」。
      wx.queue(() => ok({ nickname: '大黄的主人', avatarUrl: null }));
      await updateProfile({ avatarUrl: null }, client);
      expect(wx.sent[0].data).toEqual({ avatarUrl: null });
      expect(Object.keys(wx.sent[0].data as object)).toContain('avatarUrl');
    });

    it('fetchHistory / fetchFavorites 各打自己的路径', async () => {
      wx.queue(() => ok({ items: [], hasMore: false, page: 1 }));
      await fetchHistory({ page: 1, pageSize: 10 }, client);
      expect(wx.sent[0].url).toBe(`${BASE}/me/history`);

      wx.queue(
        () => ok({ items: [], hasMore: false, page: 1 }),
        () => ok({ items: [], hasMore: false, page: 1 }),
      );
      await fetchFavorites({ page: 1, pageSize: 10 }, client);
      expect(wx.sent[1].url).toBe(`${BASE}/me/favorites`);
    });
  });

  describe('宠物写端点', () => {
    it('createPet 发 POST /pets', async () => {
      wx.queue(() => ok({ id: 'p-9' }));
      const res = await createPet({ name: '阿花', species: 'cat' }, client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/pets`);
      expect(wx.sent[0].data).toEqual({ name: '阿花', species: 'cat' });
      expect(res.id).toBe('p-9');
    });

    it('updatePet 发 PUT /pets/:id（同 /me：PATCH 发不出去）', async () => {
      wx.queue(() => ok({ id: 'p-1' }));
      await updatePet('p-1', { bio: '换个简介' }, client);
      expect(wx.sent[0].method).toBe('PUT');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1`);
      expect(wx.sent[0].data).toEqual({ bio: '换个简介' });
    });

    it('deletePet 发 DELETE /pets/:id', async () => {
      wx.queue(() => ok({ deleted: true }));
      const res = await deletePet('p-1', client);
      expect(wx.sent[0].method).toBe('DELETE');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1`);
      expect(res.deleted).toBe(true);
    });

    it('addPetPhoto 带宽高，removePetPhoto 拼两段 id', async () => {
      wx.queue(() => ok({ id: 'ph-9', url: '/uploads/u-1/a.jpg' }));
      await addPetPhoto('p-1', { url: '/uploads/u-1/a.jpg', width: 400, height: 300 }, client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1/photos`);
      expect(wx.sent[0].data).toEqual({ url: '/uploads/u-1/a.jpg', width: 400, height: 300 });

      wx.queue(() => ok({ deleted: true }), () => ok({ deleted: true }));
      await removePetPhoto('p-1', 'ph-9', client);
      expect(wx.sent[1].method).toBe('DELETE');
      expect(wx.sent[1].url).toBe(`${BASE}/pets/p-1/photos/ph-9`);
    });

    it('favoritePet / unfavoritePet 打宠物自己的收藏端点', async () => {
      wx.queue(() => ok({ isFavorite: true }), () => ok({ isFavorite: false }));
      await favoritePet('p-1', client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/pets/p-1/favorite`);
      await unfavoritePet('p-1', client);
      expect(wx.sent[1].method).toBe('DELETE');
    });
  });

  describe('图片上传', () => {
    const RESULT = {
      key: 'u-1/abc.jpg',
      url: '/uploads/u-1/abc.jpg',
      width: 400,
      height: 300,
      auditStatus: 'pending',
    };

    it('走 wx.uploadFile 而不是 wx.request，字段名是 file，宽高进 formData', async () => {
      wx.queueUpload(() => okText(RESULT));
      const res = await uploadImage(
        { filePath: 'wxfile://tmp/1.jpg', width: 400, height: 300 },
        client,
      );
      expect(wx.sent).toHaveLength(0);
      expect(wx.uploaded[0].url).toBe(`${BASE}/uploads`);
      expect(wx.uploaded[0].name).toBe('file');
      expect(wx.uploaded[0].filePath).toBe('wxfile://tmp/1.jpg');
      // multipart 的字段一律是字符串，服务端的 parseDimension 只收字符串。
      expect(wx.uploaded[0].formData).toEqual({ width: '400', height: '300' });
      expect(wx.uploaded[0].header?.Authorization).toBe('Bearer t');
      expect(res).toEqual(RESULT);
    });

    it('业务错误码照常抛 ApiError（上传也走同一套信封）', async () => {
      wx.queueUpload(() => ({
        statusCode: 200,
        data: JSON.stringify({ code: 42200, message: '必须提供图片的真实宽高', data: null }),
      }));
      await expect(
        uploadImage({ filePath: 'wxfile://tmp/1.jpg', width: 0, height: 0 }, client),
      ).rejects.toBeInstanceOf(ApiError);
    });

    it('响应体不是 JSON 时也抛 ApiError，不是 SyntaxError', async () => {
      // 反向代理返回 HTML 错误页是真会发生的；页面拿到 ApiError 才有中文文案可显示。
      wx.queueUpload(() => ({ statusCode: 502, data: '<html>502</html>' }));
      const error = await uploadImage({ filePath: 'wxfile://tmp/1.jpg', width: 1, height: 1 }, client)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
    });

    it('401 时刷新令牌重试一次', async () => {
      wx.setStorage(TOKEN_STORAGE_KEY, 'stale');
      wx.queue(() => ok({ token: 'fresh' }));
      wx.queueUpload(
        () => ({ statusCode: 401, data: JSON.stringify({ code: 40100, message: '', data: null }) }),
        () => okText(RESULT),
      );
      const res = await uploadImage({ filePath: 'wxfile://tmp/1.jpg', width: 400, height: 300 }, client);
      expect(wx.uploaded).toHaveLength(2);
      expect(wx.uploaded[1].header?.Authorization).toBe('Bearer fresh');
      expect(res.url).toBe(RESULT.url);
    });
  });
});
