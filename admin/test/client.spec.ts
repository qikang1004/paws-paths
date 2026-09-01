import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@paws/types';
import { ApiError, UnauthorizedError, api } from '../src/api/client';
import { loadSession, saveSession } from '../src/api/session';
import { envelope, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API 客户端', () => {
  it('成功时只把 data 交出来，不含包络', async () => {
    stubFetch([envelope({ items: [], hasMore: false, page: 1 })]);
    await expect(api.get('/moderation/tasks')).resolves.toEqual({
      items: [],
      hasMore: false,
      page: 1,
    });
  });

  it('有会话时带 Bearer 头', async () => {
    saveSession({ token: 'tok-123', username: 'ops', role: 'moderator' });
    const calls = stubFetch([envelope(null)]);
    await api.get('/moderation/tasks');
    expect(new Headers(calls[0].init.headers).get('Authorization')).toBe('Bearer tok-123');
  });

  it('没会话时不带 Authorization 头', async () => {
    const calls = stubFetch([envelope(null)]);
    await api.get('/moderation/tasks');
    expect(new Headers(calls[0].init.headers).has('Authorization')).toBe(false);
  });

  it('路径前面拼上 /api 前缀', async () => {
    const calls = stubFetch([envelope(null)]);
    await api.get('/moderation/tasks?page=2');
    expect(calls[0].url).toBe('/api/moderation/tasks?page=2');
  });

  /**
   * **判据是业务码，不是 HTTP 状态。** 服务端的 422 带 `VALIDATION_FAILED`，
   * 而这一条用 HTTP 200 配一个非 0 的码 —— 若客户端看的是 `response.ok`，
   * 它会把这条当成功。
   */
  it('HTTP 200 但业务码非 0 时也抛错', async () => {
    stubFetch([envelope(null, ERROR_CODES.MODERATION_TASK_HANDLED, '这条工单已被处理')]);
    await expect(api.post('/moderation/tasks/t-1/resolve')).rejects.toBeInstanceOf(ApiError);
  });

  it('抛出的错带上服务端的码与文案', async () => {
    stubFetch([envelope(null, ERROR_CODES.MODERATION_TASK_HANDLED, '这条工单已被处理')]);
    const err = await api.post('/moderation/tasks/t-1/resolve').catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: ERROR_CODES.MODERATION_TASK_HANDLED,
      message: '这条工单已被处理',
    });
  });

  /**
   * 401 要做两件事，缺一件都会让界面卡在「已登录但每次请求都失败」：
   * ① 抛一个可辨认的错误类型；② **就地清掉本地会话**。
   */
  it('401 抛 UnauthorizedError', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'admin' });
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    await expect(api.get('/moderation/tasks')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('401 之后本地会话被清掉', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'admin' });
    stubFetch([envelope(null, ERROR_CODES.UNAUTHORIZED, '登录已过期')], 401);
    await api.get('/moderation/tasks').catch(() => undefined);
    expect(loadSession()).toBeNull();
  });

  /**
   * 反代挂掉会回一段 HTML。直接 `.json()` 会抛 SyntaxError，界面上表现成
   * 「操作失败：Unexpected token <」—— 对运营毫无意义。
   */
  it('非 JSON 响应收敛成可读的错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 }))),
    );
    const err = await api.get('/moderation/tasks').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toContain('502');
  });

  /** HTTP 401 且响应体不是包络时，仍要走「令牌失效」那条路。 */
  it('401 但响应体不是包络时也算令牌失效', async () => {
    saveSession({ token: 'tok', username: 'ops', role: 'admin' });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('nope', { status: 401 }))));
    await expect(api.get('/moderation/tasks')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('断网时给出网络相关的文案，而不是一个空错误', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    const err = await api.get('/moderation/tasks').catch((e: unknown) => e);
    expect((err as ApiError).message).toContain('网络');
  });

  it('POST 带 body 时设置 JSON 的 Content-Type', async () => {
    const calls = stubFetch([envelope(null)]);
    await api.post('/moderation/tasks/t-1/resolve', { result: 'approved' });
    expect(new Headers(calls[0].init.headers).get('Content-Type')).toBe('application/json');
  });
});
