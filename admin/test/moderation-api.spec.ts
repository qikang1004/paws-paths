import { afterEach, describe, expect, it, vi } from 'vitest';
import { PAGE_SIZE, fetchTasks, resolveTask } from '../src/api/moderation';
import { bodyOf, envelope, stubFetch } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('工单接口的包装', () => {
  it('列表带上页码与页大小', async () => {
    const calls = stubFetch([envelope({ items: [], hasMore: false, page: 3 })]);
    await fetchTasks(3);
    expect(calls[0].url).toBe(`/api/moderation/tasks?page=3&pageSize=${PAGE_SIZE}`);
  });

  /**
   * 页大小不能超过服务端 `parseListQuery` 的上限 20 —— 超了是 422。
   * 这条断言把那个契约钉在测试里，改大常量会立刻红。
   */
  it('页大小不超过服务端允许的上限', () => {
    expect(PAGE_SIZE).toBeLessThanOrEqual(20);
  });

  it('工单 id 经过 URL 编码', async () => {
    const calls = stubFetch([envelope({ taskId: 'a/b', result: 'approved' })]);
    await resolveTask('a/b', 'approved');
    expect(calls[0].url).toBe('/api/moderation/tasks/a%2Fb/resolve');
  });

  it('驳回时把原因一起发出去', async () => {
    const calls = stubFetch([envelope({ taskId: 't-1', result: 'rejected' })]);
    await resolveTask('t-1', 'rejected', '辱骂他人');
    expect(bodyOf(calls[0])).toEqual({ result: 'rejected', rejectReason: '辱骂他人' });
  });

  /**
   * 放行时**不带** `rejectReason`。服务端会把它丢掉（`parseResolve`），所以这不是
   * 正确性问题 —— 但发一个必然被忽略的字段，会让读接口日志的人以为放行也能写备注。
   */
  it('放行时不带驳回原因', async () => {
    const calls = stubFetch([envelope({ taskId: 't-1', result: 'approved' })]);
    await resolveTask('t-1', 'approved', '这个不该被发出去');
    expect(bodyOf(calls[0])).toEqual({ result: 'approved' });
  });
});
