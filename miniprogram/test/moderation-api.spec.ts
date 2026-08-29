import { fetchFeed } from '../api/posts';
import { reportPost } from '../api/reports';
import { ApiClient } from '../api/request';
import { SessionStore, TOKEN_STORAGE_KEY } from '../store/session';
import { FakeWx, ok } from './fake-wx';

const BASE = 'https://api.example.com';

/**
 * 阶段 3 的 api 包装：举报与关注流。
 *
 * 与阶段 2 那批（`social-api.spec.ts`）分开成一个文件，理由同服务端把
 * `/reports` 与 `/moderation/*` 拆两个 controller —— 阶段边界在排查时有用。
 *
 * 这一层只做两件事：拼 URL/参数、把信封解开。页面一行 `wx.request` 都不写
 * （Global Constraint 3，由 `wx-guard` 兜住）。
 */
describe('阶段 3 api 包装', () => {
  let wx: FakeWx;
  let client: ApiClient;

  beforeEach(() => {
    wx = new FakeWx();
    wx.setStorage(TOKEN_STORAGE_KEY, 't');
    client = new ApiClient(wx, new SessionStore(wx, BASE), BASE);
  });

  describe('举报', () => {
    it('reportPost 发 POST /reports，body 带 targetType / targetId / reason', async () => {
      wx.queue(() => ok({ targetType: 'post', targetId: 'po-1', status: 'pending_review' }));
      const res = await reportPost('po-1', 'spam', client);
      expect(wx.sent[0].method).toBe('POST');
      expect(wx.sent[0].url).toBe(`${BASE}/reports`);
      // `targetType` 由包装写死成 `post`，不让调用方传 —— 页面上的举报入口
      // 指向的就是一条动态，把类型开放出去只会让某处传错。
      expect(wx.sent[0].data).toEqual({
        targetType: 'post',
        targetId: 'po-1',
        reason: 'spam',
      });
      expect(res.status).toBe('pending_review');
    });

    it('reportPost 把服务端的 200 幂等分支照常当成功返回', async () => {
      // 重复举报同一条也是 200（Global Constraint 27）。客户端两条路走同一个分支，
      // 所以包装层不需要区分「新建了工单」和「早就在队列里」。
      wx.queue(() => ok({ targetType: 'post', targetId: 'po-1', status: 'pending_review' }));
      const res = await reportPost('po-1', 'abuse', client);
      expect(res.targetId).toBe('po-1');
    });

    it('reportImage 发同一个端点，targetType 是 post_image', async () => {
      wx.queue(() => ok({ targetType: 'post_image', targetId: 'pi-1', status: 'pending_review' }));
      const { reportImage } = await import('../api/reports');
      await reportImage('pi-1', 'porn', client);
      expect(wx.sent[0].url).toBe(`${BASE}/reports`);
      expect(wx.sent[0].data).toEqual({
        targetType: 'post_image',
        targetId: 'pi-1',
        reason: 'porn',
      });
    });
  });

  describe('关注流', () => {
    it('fetchFeed 发 GET /me/feed，分页进 data', async () => {
      wx.queue(() => ok({ items: [], hasMore: false, page: 2 }));
      await fetchFeed({ page: 2, pageSize: 20 }, client);
      expect(wx.sent[0].method).toBe('GET');
      expect(wx.sent[0].url).toBe(`${BASE}/me/feed`);
      expect(wx.sent[0].data).toEqual({ page: 2, pageSize: 20 });
    });

    it('fetchFeed 不带 petId —— feed 是跨宠物混排的', async () => {
      wx.queue(() => ok({ items: [], hasMore: false, page: 1 }));
      await fetchFeed({ page: 1, pageSize: 10 }, client);
      expect(Object.keys(wx.sent[0].data as object)).toEqual(['page', 'pageSize']);
    });

    it('fetchFeed 解包出 PagedResponse<PostDto> 形状', async () => {
      const items = [{ id: 'po-1', petId: 'p-2', petName: '奶昔', auditStatus: 'approved' }];
      wx.queue(() => ok({ items, hasMore: true, page: 1 }));
      const res = await fetchFeed({ page: 1, pageSize: 10 }, client);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].petName).toBe('奶昔');
      expect(res.hasMore).toBe(true);
      expect(res.page).toBe(1);
    });
  });
});
